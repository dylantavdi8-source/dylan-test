import type { AgentRole, RunStatus, TaskStatus } from "./types.js";

export const AGENT_META: Record<AgentRole, { label: string; short: string; color: string }> = {
  manager: { label: "Manager", short: "MGR", color: "#f6c66c" },
  research: { label: "Research", short: "RES", color: "#6cc6f6" },
  coding: { label: "Coding", short: "DEV", color: "#8b93ff" },
  design: { label: "Design", short: "DSN", color: "#f68bd8" },
  testing: { label: "Testing / QA", short: "QA", color: "#6cf6a0" },
  review: { label: "Review", short: "REV", color: "#f68b6c" },
};

export const TASK_STATUS_META: Record<TaskStatus, { label: string; className: string; dot: string }> = {
  pending: { label: "Queued", className: "text-white/45 bg-white/[0.04] border-white/10", dot: "bg-white/30" },
  running: { label: "Working", className: "text-accent-400 bg-accent-500/10 border-accent-500/30", dot: "bg-accent-400 animate-pulseSoft" },
  blocked: { label: "Blocked", className: "text-amber-300 bg-amber-500/10 border-amber-500/30", dot: "bg-amber-400" },
  needs_retry: { label: "Retrying", className: "text-amber-300 bg-amber-500/10 border-amber-500/30", dot: "bg-amber-400 animate-pulseSoft" },
  completed: { label: "Done", className: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30", dot: "bg-emerald-400" },
  failed: { label: "Failed", className: "text-rose-300 bg-rose-500/10 border-rose-500/30", dot: "bg-rose-400" },
};

export const RUN_STATUS_META: Record<RunStatus, { label: string; className: string }> = {
  planning: { label: "Planning", className: "text-accent-400 bg-accent-500/10 border-accent-500/30" },
  running: { label: "In progress", className: "text-accent-400 bg-accent-500/10 border-accent-500/30" },
  completed: { label: "Completed", className: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30" },
  failed: { label: "Failed", className: "text-rose-300 bg-rose-500/10 border-rose-500/30" },
};

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
