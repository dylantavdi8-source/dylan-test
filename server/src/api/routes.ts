import { Router } from "express";
import { z } from "zod";
import { store } from "../db/db.js";
import { startRun } from "../orchestrator/engine.js";
import { listWorkspaceFiles, readWorkspaceFile } from "../sandbox/workspace.js";
import { getLlmProvider } from "../llm/client.js";
import { getEbayClient } from "../ebay/index.js";

export const router = Router();

const CreateRunInput = z.object({
  prompt: z.string().max(20000),
  imageDataUrl: z.string().max(16_000_000).optional(),
  sellSpeed: z.number().int().min(0).max(100).optional(),
}).refine((v) => v.prompt.trim().length > 0 || !!v.imageDataUrl, { message: "Provide a prompt or a photo." });

function parseDataUrl(dataUrl: string): { mediaType: string; base64: string } | null {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mediaType: match[1], base64: match[2] };
}

router.get("/health", (_req, res) => {
  const ebay = getEbayClient();
  res.json({ ok: true, llmMode: getLlmProvider().mode, ebayMode: ebay.mode, ebayLiveActions: ebay.liveActionsEnabled });
});

router.post("/runs", async (req, res) => {
  const parsed = CreateRunInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  let image: { mediaType: string; base64: string } | undefined;
  if (parsed.data.imageDataUrl) {
    const decoded = parseDataUrl(parsed.data.imageDataUrl);
    if (!decoded) {
      res.status(400).json({ error: "Photo must be a PNG, JPEG, or WEBP image." });
      return;
    }
    image = decoded;
  }
  const prompt = parsed.data.prompt.trim() || "List this item for sale based on the attached photo.";
  const runId = await startRun(prompt, image, parsed.data.sellSpeed ?? 50);
  res.status(201).json({ runId });
});

router.get("/runs", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ runs: store.listRuns(limit) });
});

router.get("/runs/:id", (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  const tasks = store.listTasksForRun(run.id);
  const events = store.listEventsForRun(run.id);
  res.json({ run, tasks, events });
});

router.get("/runs/:id/files", async (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run || !run.workspaceDir) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  const files = await listWorkspaceFiles(run.workspaceDir);
  res.json({ files });
});

router.get("/runs/:id/files/*", (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run || !run.workspaceDir) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  const relPath = (req.params as Record<string, string>)[0];
  try {
    const content = readWorkspaceFile(run.workspaceDir, relPath);
    res.type("text/plain").send(content);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "File not found" });
  }
});
