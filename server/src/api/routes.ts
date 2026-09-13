import { Router } from "express";
import { z } from "zod";
import { store } from "../db/db.js";
import { startRun } from "../orchestrator/engine.js";
import { listWorkspaceFiles, readWorkspaceFile } from "../sandbox/workspace.js";
import { getLlmProvider } from "../llm/client.js";

export const router = Router();

const CreateRunInput = z.object({ prompt: z.string().min(1).max(20000) });

router.get("/health", (_req, res) => {
  res.json({ ok: true, llmMode: getLlmProvider().mode });
});

router.post("/runs", async (req, res) => {
  const parsed = CreateRunInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const runId = await startRun(parsed.data.prompt);
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
