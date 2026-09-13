import type { AgentRole, TaskRecord } from "../lib/types.js";
import { AGENT_META } from "../lib/meta.js";

export type AgentBoardStatus = "idle" | "working" | "retrying" | "done" | "failed";

function deriveStatus(tasks: TaskRecord[]): AgentBoardStatus {
  if (tasks.some((t) => t.status === "running")) return "working";
  if (tasks.some((t) => t.status === "needs_retry" || t.status === "blocked")) return "retrying";
  if (tasks.length === 0) return "idle";
  if (tasks.every((t) => t.status === "completed")) return "done";
  if (tasks.some((t) => t.status === "failed")) return "failed";
  return "idle";
}

const STATUS_STYLE: Record<AgentBoardStatus, { label: string; ring: string; dot: string }> = {
  idle: { label: "Idle", ring: "border-white/10", dot: "bg-white/25" },
  working: { label: "Working", ring: "border-accent-500/50", dot: "bg-accent-400 animate-pulseSoft" },
  retrying: { label: "Retrying", ring: "border-amber-500/50", dot: "bg-amber-400 animate-pulseSoft" },
  done: { label: "Done", ring: "border-emerald-500/40", dot: "bg-emerald-400" },
  failed: { label: "Failed", ring: "border-rose-500/40", dot: "bg-rose-400" },
};

export function AgentCard({ role, tasks }: { role: AgentRole; tasks: TaskRecord[] }) {
  const meta = AGENT_META[role];
  const status = deriveStatus(tasks);
  const style = STATUS_STYLE[status];
  const current = tasks.find((t) => t.status === "running") ?? tasks.find((t) => t.status === "needs_retry" || t.status === "blocked");
  const active = status === "working" || status === "retrying";

  return (
    <div
      className={`glass relative rounded-xl border p-3.5 transition-all ${style.ring} ${active ? "shadow-glow" : ""}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold text-black/80"
            style={{ background: meta.color }}
          >
            {meta.short}
          </span>
          <span className="text-sm font-medium text-white/90">{meta.label}</span>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-white/45">
          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
          {style.label}
        </span>
      </div>
      <div className="mt-2 min-h-[2.2em] text-xs leading-snug text-white/55">
        {current ? current.title : tasks.length === 0 ? "Not needed for this request" : "Waiting"}
      </div>
    </div>
  );
}
