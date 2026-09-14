import type { AgentRole, TaskRecord } from "../lib/types.js";
import { AGENT_META } from "../lib/meta.js";

export type AgentBoardStatus = "idle" | "working" | "retrying" | "done" | "failed";

export function deriveStatus(tasks: TaskRecord[]): AgentBoardStatus {
  if (tasks.some((t) => t.status === "running")) return "working";
  if (tasks.some((t) => t.status === "needs_retry" || t.status === "blocked")) return "retrying";
  if (tasks.length === 0) return "idle";
  if (tasks.every((t) => t.status === "completed")) return "done";
  if (tasks.some((t) => t.status === "failed")) return "failed";
  return "idle";
}

const STATUS_STYLE: Record<AgentBoardStatus, { label: string; ring: string; dot: string; text: string }> = {
  idle: { label: "Idle", ring: "border-white/10", dot: "bg-white/25", text: "text-white/40" },
  working: { label: "Working", ring: "border-accent-500/50", dot: "bg-accent-400 animate-pulseSoft", text: "text-accent-300" },
  retrying: { label: "Retrying", ring: "border-amber-500/50", dot: "bg-amber-400 animate-pulseSoft", text: "text-amber-300" },
  done: { label: "Done", ring: "border-emerald-500/40", dot: "bg-emerald-400", text: "text-emerald-300" },
  failed: { label: "Failed", ring: "border-rose-500/40", dot: "bg-rose-400", text: "text-rose-300" },
};

export function currentTaskFor(tasks: TaskRecord[]): TaskRecord | undefined {
  return tasks.find((t) => t.status === "running") ?? tasks.find((t) => t.status === "needs_retry" || t.status === "blocked");
}

/** A compact roster row for the left-hand worker list. */
export function AgentCard({ role, tasks, active }: { role: AgentRole; tasks: TaskRecord[]; active?: boolean }) {
  const meta = AGENT_META[role];
  const Icon = meta.icon;
  const status = deriveStatus(tasks);
  const style = STATUS_STYLE[status];
  const current = currentTaskFor(tasks);
  const isActive = active ?? (status === "working" || status === "retrying");

  return (
    <div
      className={`glass relative flex items-center gap-3 rounded-xl border p-3 transition-all ${style.ring} ${
        isActive ? "shadow-glow bg-white/[0.04]" : ""
      }`}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `${meta.color}22`, color: meta.color }}
      >
        <Icon size={18} strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-white/90">
            {meta.name} <span className="text-white/35">· {meta.label}</span>
          </span>
          <span className={`flex shrink-0 items-center gap-1.5 text-[10px] ${style.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
            {style.label}
          </span>
        </div>
        <div className="truncate text-[11px] text-white/40">{current ? current.title : tasks.length === 0 ? meta.blurb : "Waiting"}</div>
      </div>
    </div>
  );
}
