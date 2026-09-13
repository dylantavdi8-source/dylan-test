import type { RunRecord, TaskRecord, RunEvent, GeneratedFile } from "./types.js";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function createRun(prompt: string): Promise<{ runId: string }> {
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  return asJson(res);
}

export async function listRuns(): Promise<RunRecord[]> {
  const res = await fetch("/api/runs");
  const data = await asJson<{ runs: RunRecord[] }>(res);
  return data.runs;
}

export async function getRun(id: string): Promise<{ run: RunRecord; tasks: TaskRecord[]; events: RunEvent[] }> {
  const res = await fetch(`/api/runs/${id}`);
  return asJson(res);
}

export async function listRunFiles(id: string): Promise<GeneratedFile[]> {
  const res = await fetch(`/api/runs/${id}/files`);
  const data = await asJson<{ files: GeneratedFile[] }>(res);
  return data.files;
}

export async function readRunFile(id: string, path: string): Promise<string> {
  const res = await fetch(`/api/runs/${id}/files/${path}`);
  if (!res.ok) throw new Error(`File not found: ${path}`);
  return res.text();
}
