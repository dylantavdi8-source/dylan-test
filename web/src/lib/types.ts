export type AgentRole = "manager" | "listing" | "pricing" | "inventory" | "messages" | "compliance";
export type RunStatus = "planning" | "running" | "completed" | "failed";
export type TaskStatus = "pending" | "running" | "blocked" | "needs_retry" | "completed" | "failed";

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
  feedback: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RunEvent {
  id: string;
  runId: string;
  taskId: string | null;
  type: string;
  agentRole: AgentRole | null;
  message: string;
  data: unknown;
  createdAt: number;
}

export interface GeneratedFile {
  path: string;
  bytes: number;
}
