import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve, relative, dirname, sep } from "node:path";
import type { GeneratedFile } from "../types.js";

const ROOT = resolve(process.env.RUN_WORKSPACES_DIR ?? "run-workspaces");
mkdirSync(ROOT, { recursive: true });

export function createWorkspace(runId: string): string {
  const dir = join(ROOT, runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function safeResolve(workspaceDir: string, relPath: string): string {
  const base = resolve(workspaceDir);
  const target = resolve(base, relPath);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`Path escapes workspace sandbox: ${relPath}`);
  }
  return target;
}

export function writeWorkspaceFile(workspaceDir: string, relPath: string, content: string): GeneratedFile {
  const target = safeResolve(workspaceDir, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
  const stat = statSync(target);
  return { path: relPath, bytes: stat.size };
}

export function readWorkspaceFile(workspaceDir: string, relPath: string): string {
  const target = safeResolve(workspaceDir, relPath);
  if (!existsSync(target)) throw new Error(`File not found in workspace: ${relPath}`);
  return readFileSync(target, "utf8");
}

export async function listWorkspaceFiles(workspaceDir: string): Promise<GeneratedFile[]> {
  const results: GeneratedFile[] = [];
  async function walk(dir: string) {
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const stat = statSync(full);
        results.push({ path: relative(workspaceDir, full), bytes: stat.size });
      }
    }
  }
  await walk(workspaceDir);
  return results;
}
