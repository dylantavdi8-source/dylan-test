import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RunRecord, TaskRecord, RunEvent, RunStatus, TaskStatus, AgentRole, RunEventType } from "../types.js";

const DB_PATH = process.env.DB_PATH ?? "data/ai-team.sqlite";
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  final_result TEXT,
  workspace_dir TEXT,
  llm_mode TEXT NOT NULL,
  ebay_mode TEXT NOT NULL DEFAULT 'mock',
  ebay_live_actions INTEGER NOT NULL DEFAULT 0,
  has_image INTEGER NOT NULL DEFAULT 0,
  sell_speed INTEGER NOT NULL DEFAULT 50,
  error TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  agent_role TEXT NOT NULL,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  depends_on TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  output TEXT,
  feedback TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id TEXT,
  type TEXT NOT NULL,
  agent_role TEXT,
  message TEXT NOT NULL,
  data TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_run ON tasks(run_id);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id);
`);

// Lightweight migration for DB files created before these columns existed -- CREATE TABLE
// IF NOT EXISTS above doesn't add columns to an already-existing table.
try {
  db.exec(`ALTER TABLE runs ADD COLUMN has_image INTEGER NOT NULL DEFAULT 0;`);
} catch {
  // column already exists -- fine
}
try {
  db.exec(`ALTER TABLE runs ADD COLUMN sell_speed INTEGER NOT NULL DEFAULT 50;`);
} catch {
  // column already exists -- fine
}

function rowToRun(row: any): RunRecord {
  return {
    id: row.id,
    prompt: row.prompt,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finalResult: row.final_result,
    workspaceDir: row.workspace_dir,
    llmMode: row.llm_mode,
    ebayMode: row.ebay_mode,
    ebayLiveActions: !!row.ebay_live_actions,
    hasImage: !!row.has_image,
    sellSpeed: row.sell_speed,
    error: row.error,
  };
}

function rowToTask(row: any): TaskRecord {
  return {
    id: row.id,
    runId: row.run_id,
    agentRole: row.agent_role,
    title: row.title,
    instructions: row.instructions,
    dependsOn: JSON.parse(row.depends_on),
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    output: row.output,
    feedback: row.feedback,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEvent(row: any): RunEvent {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    type: row.type,
    agentRole: row.agent_role,
    message: row.message,
    data: row.data ? JSON.parse(row.data) : null,
    createdAt: row.created_at,
  };
}

export const store = {
  createRun(run: RunRecord) {
    db.prepare(
      `INSERT INTO runs (id, prompt, status, created_at, updated_at, final_result, workspace_dir, llm_mode, ebay_mode, ebay_live_actions, has_image, sell_speed, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      run.id,
      run.prompt,
      run.status,
      run.createdAt,
      run.updatedAt,
      run.finalResult,
      run.workspaceDir,
      run.llmMode,
      run.ebayMode,
      run.ebayLiveActions ? 1 : 0,
      run.hasImage ? 1 : 0,
      run.sellSpeed,
      run.error
    );
  },

  updateRun(id: string, patch: Partial<Pick<RunRecord, "status" | "finalResult" | "workspaceDir" | "error">>) {
    const current = store.getRun(id);
    if (!current) return;
    const next: RunRecord = { ...current, ...patch, updatedAt: Date.now() };
    db.prepare(
      `UPDATE runs SET status = ?, final_result = ?, workspace_dir = ?, error = ?, updated_at = ? WHERE id = ?`
    ).run(next.status, next.finalResult, next.workspaceDir, next.error, next.updatedAt, id);
  },

  getRun(id: string): RunRecord | null {
    const row = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id);
    return row ? rowToRun(row) : null;
  },

  listRuns(limit = 50): RunRecord[] {
    const rows = db.prepare(`SELECT * FROM runs ORDER BY created_at DESC LIMIT ?`).all(limit);
    return rows.map(rowToRun);
  },

  createTask(task: TaskRecord) {
    db.prepare(
      `INSERT INTO tasks (id, run_id, agent_role, title, instructions, depends_on, status, attempt, max_attempts, output, feedback, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      task.id,
      task.runId,
      task.agentRole,
      task.title,
      task.instructions,
      JSON.stringify(task.dependsOn),
      task.status,
      task.attempt,
      task.maxAttempts,
      task.output,
      task.feedback,
      task.createdAt,
      task.updatedAt
    );
  },

  updateTask(
    runId: string,
    id: string,
    patch: Partial<Pick<TaskRecord, "status" | "attempt" | "output" | "feedback">>
  ) {
    const current = store.getTask(runId, id);
    if (!current) return;
    const next: TaskRecord = { ...current, ...patch, updatedAt: Date.now() };
    db.prepare(
      `UPDATE tasks SET status = ?, attempt = ?, output = ?, feedback = ?, updated_at = ? WHERE run_id = ? AND id = ?`
    ).run(next.status, next.attempt, next.output, next.feedback, next.updatedAt, runId, id);
  },

  getTask(runId: string, id: string): TaskRecord | null {
    const row = db.prepare(`SELECT * FROM tasks WHERE run_id = ? AND id = ?`).get(runId, id);
    return row ? rowToTask(row) : null;
  },

  listTasksForRun(runId: string): TaskRecord[] {
    const rows = db.prepare(`SELECT * FROM tasks WHERE run_id = ? ORDER BY created_at ASC`).all(runId);
    return rows.map(rowToTask);
  },

  addEvent(event: RunEvent) {
    db.prepare(
      `INSERT INTO events (id, run_id, task_id, type, agent_role, message, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.id,
      event.runId,
      event.taskId,
      event.type,
      event.agentRole,
      event.message,
      event.data ? JSON.stringify(event.data) : null,
      event.createdAt
    );
  },

  listEventsForRun(runId: string): RunEvent[] {
    const rows = db.prepare(`SELECT * FROM events WHERE run_id = ? ORDER BY created_at ASC`).all(runId);
    return rows.map(rowToEvent);
  },
};

export type { RunStatus, TaskStatus, AgentRole, RunEventType };
