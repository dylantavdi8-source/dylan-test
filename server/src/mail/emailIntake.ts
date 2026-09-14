import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import nodemailer from "nodemailer";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { startRun } from "../orchestrator/engine.js";
import { store } from "../db/db.js";

// Lets you email a photo + request to yourself and have it turn into a real run, with
// the result emailed back -- works from anywhere with cell data, no public server
// exposure needed, since the Mac only ever reaches OUT to Gmail (never the reverse).

const STATE_PATH = process.env.EMAIL_INTAKE_STATE_PATH ?? "data/email-intake-state.json";
const POLL_MS = Number(process.env.EMAIL_INTAKE_POLL_SECONDS ?? 30) * 1000;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

interface IntakeConfig {
  user: string;
  appPassword: string;
}

interface IntakeState {
  lastUid: number;
}

function getConfig(): IntakeConfig | null {
  const user = process.env.EMAIL_INTAKE_USER;
  const appPassword = process.env.EMAIL_INTAKE_APP_PASSWORD;
  if (!user || !appPassword) return null;
  return { user, appPassword };
}

function loadState(): IntakeState {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { lastUid: 0 };
  }
}

function saveState(state: IntakeState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state));
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[email-intake] ${msg}`);
}

/** Mirrors the voice assistant's speech cleanup (web/src/hooks/useVoiceAssistant.ts) --
 * strips raw JSON tool results and markdown noise so the reply email reads like a normal
 * message instead of debug output. Kept as its own small copy since web/ and server/ are
 * separate packages with no shared lib. */
function cleanForEmail(text: string): string {
  let noJson = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") { depth++; continue; }
    if (ch === "}") { if (depth > 0) depth--; continue; }
    if (depth === 0) noJson += ch;
  }
  return noJson
    .replace(/```[\s\S]*?```/g, "")
    .replace(/Tool result:\s*/gi, "")
    .replace(/,?\s*id=[\w-]+/gi, "")
    .replace(/_/g, " ")
    .replace(/[#*`>~]/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[{}[\]|]/g, "")
    .replace(/:\s*(?=[.,;!?]|$)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function waitForRunCompletion(runId: string, timeoutMs = 120_000) {
  const start = Date.now();
  for (;;) {
    const run = store.getRun(runId);
    if (run && (run.status === "completed" || run.status === "failed")) return run;
    if (Date.now() - start >= timeoutMs) return run;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function sendReply(cfg: IntakeConfig, subject: string, body: string): Promise<void> {
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: cfg.user, pass: cfg.appPassword },
  });
  await transport.sendMail({
    from: cfg.user,
    to: cfg.user,
    subject: `Re: ${subject}`,
    text: body,
  });
}

async function handleParsedMessage(cfg: IntakeConfig, parsed: ParsedMail): Promise<void> {
  const subject = parsed.subject?.trim() || "New request";
  const bodyText = (parsed.text ?? "").trim();
  const imageAttachment = parsed.attachments.find((a) => ALLOWED_IMAGE_TYPES.has(a.contentType));

  const prompt = bodyText || "List this item for sale based on the attached photo.";
  const image = imageAttachment ? { mediaType: imageAttachment.contentType, base64: imageAttachment.content.toString("base64") } : undefined;

  log(`New email from ${parsed.from?.text ?? "unknown sender"}: "${subject}"${image ? " (with photo)" : ""}`);
  const runId = await startRun(prompt, image, 50);
  const run = await waitForRunCompletion(runId);

  if (!run) {
    await sendReply(cfg, subject, "Something went wrong starting the run -- no result to report.");
    return;
  }
  const body =
    run.status === "completed"
      ? cleanForEmail(run.finalResult ?? "Done, but no summary was produced.")
      : `The run didn't finish successfully: ${cleanForEmail(run.error ?? "unknown error")}`;
  await sendReply(cfg, subject, body);
  log(`Replied for run ${runId} (${run.status}).`);
}

async function pollOnce(cfg: IntakeConfig): Promise<void> {
  const state = loadState();
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: cfg.user, pass: cfg.appPassword },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      if (state.lastUid === 0) {
        // First run ever -- don't replay the whole mailbox history, just start
        // watching from whatever arrives next.
        const status = await client.status("INBOX", { uidNext: true });
        saveState({ lastUid: (status.uidNext ?? 1) - 1 });
        return;
      }

      let maxSeenUid = state.lastUid;
      for await (const message of client.fetch(`${state.lastUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
        if (message.uid <= state.lastUid) continue;
        maxSeenUid = Math.max(maxSeenUid, message.uid);
        if (!message.source) continue;
        try {
          const parsed = await simpleParser(message.source);
          await handleParsedMessage(cfg, parsed);
        } catch (err) {
          log(`Failed to process message uid ${message.uid}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (maxSeenUid > state.lastUid) saveState({ lastUid: maxSeenUid });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

export function startEmailIntake(): void {
  const cfg = getConfig();
  if (!cfg) return;
  log(`Watching ${cfg.user} for new emails every ${POLL_MS / 1000}s.`);

  const loop = async () => {
    try {
      await pollOnce(cfg);
    } catch (err) {
      log(`Poll failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTimeout(loop, POLL_MS);
    }
  };
  loop();
}
