// Shared types used across the orchestrator, agents, db, and API layers.

export type AgentRole =
  | "manager"
  | "listing"
  | "pricing"
  | "inventory"
  | "messages"
  | "compliance";

export type RunStatus =
  | "planning"
  | "running"
  | "completed"
  | "failed";

export type TaskStatus =
  | "pending"
  | "running"
  | "blocked" // waiting on dependencies
  | "needs_retry"
  | "completed"
  | "failed";

export interface RunRecord {
  id: string;
  prompt: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  finalResult: string | null;
  workspaceDir: string | null;
  llmMode: "live" | "mock";
  ebayMode: "live" | "mock";
  ebayLiveActions: boolean;
  error: string | null;
}

export interface TaskRecord {
  id: string;
  runId: string;
  agentRole: AgentRole;
  title: string;
  instructions: string;
  dependsOn: string[];
  status: TaskStatus;
  attempt: number;
  maxAttempts: number;
  output: string | null;
  feedback: string | null; // feedback from a reviewer/QA agent that triggered a retry
  createdAt: number;
  updatedAt: number;
}

export type RunEventType =
  | "run.created"
  | "run.planning"
  | "run.plan_ready"
  | "run.completed"
  | "run.failed"
  | "task.created"
  | "task.started"
  | "task.tool_call"
  | "task.tool_result"
  | "task.handoff"
  | "task.flagged"
  | "task.retry"
  | "task.completed"
  | "task.failed"
  | "task.blocked_resolved"
  | "guardrail.triggered"
  | "agent.message";

export interface RunEvent {
  id: string;
  runId: string;
  taskId: string | null;
  type: RunEventType;
  agentRole: AgentRole | null;
  message: string;
  data: unknown;
  createdAt: number;
}

export interface PlanTaskInput {
  id: string;
  title: string;
  agentRole: AgentRole;
  instructions: string;
  dependsOn: string[];
}

export interface GeneratedFile {
  path: string;
  bytes: number;
}
