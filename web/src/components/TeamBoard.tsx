import type { AgentRole, TaskRecord, RunRecord } from "../lib/types.js";
import { AgentCard } from "./AgentCard.js";

const ORDER: AgentRole[] = ["research", "design", "coding", "testing", "review"];

export function TeamBoard({ run, tasks }: { run: RunRecord; tasks: TaskRecord[] }) {
  const roles = ORDER.filter((r) => tasks.some((t) => t.agentRole === r));
  const managerBusy = run.status === "planning" || (run.status === "running" && tasks.every((t) => t.status === "completed"));

  if (roles.length === 0) {
    return (
      <div className="glass rounded-xl border border-white/10 p-4 text-sm text-white/60">
        The manager handled this directly -- no specialist agents were needed.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <div
        className={`glass relative rounded-xl border p-3.5 transition-all ${
          managerBusy ? "border-amber-500/50 shadow-glow" : "border-white/10"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold text-black/80" style={{ background: "#f6c66c" }}>
              MGR
            </span>
            <span className="text-sm font-medium text-white/90">Manager</span>
          </div>
          <span className="flex items-center gap-1.5 text-[11px] text-white/45">
            <span className={`h-1.5 w-1.5 rounded-full ${managerBusy ? "bg-amber-400 animate-pulseSoft" : "bg-emerald-400"}`} />
            {managerBusy ? "Orchestrating" : "Delegated"}
          </span>
        </div>
        <div className="mt-2 min-h-[2.2em] text-xs leading-snug text-white/55">
          {run.status === "planning"
            ? "Deciding which specialists are needed"
            : run.status === "completed" || run.status === "failed"
            ? "Delegated to the team and synthesized the final result"
            : managerBusy
            ? "Synthesizing the final result"
            : "Coordinating the team"}
        </div>
      </div>
      {roles.map((role) => (
        <AgentCard key={role} role={role} tasks={tasks.filter((t) => t.agentRole === role)} />
      ))}
    </div>
  );
}
