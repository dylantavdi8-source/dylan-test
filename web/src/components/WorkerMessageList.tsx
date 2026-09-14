import type { AgentRole, RunRecord, TaskRecord } from "../lib/types.js";
import { AGENT_META, relativeTime } from "../lib/meta.js";
import { deriveStatus, currentTaskFor } from "./AgentCard.js";

const ROSTER: AgentRole[] = ["manager", "listing", "pricing", "inventory", "messages", "compliance"];

function previewFor(role: AgentRole, roleTasks: TaskRecord[], run: RunRecord): { text: string; time: number | null } {
  if (role === "manager") {
    if (run.status === "planning") return { text: "Reading your request and building the plan…", time: run.updatedAt };
    if (run.status === "completed") return { text: "Done -- wrapped up and reported back.", time: run.updatedAt };
    if (run.status === "failed") return { text: "Hit a problem -- see the result below.", time: run.updatedAt };
    const allDone = roleTasks.length === 0 ? false : roleTasks.every((t) => t.status === "completed");
    return { text: allDone ? "Reviewing everyone's work…" : "Coordinating the team…", time: run.updatedAt };
  }
  if (roleTasks.length === 0) return { text: "Not needed for this one", time: null };
  const current = currentTaskFor(roleTasks);
  if (current) return { text: current.title, time: current.updatedAt };
  const last = [...roleTasks].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const status = deriveStatus(roleTasks);
  const prefix = status === "failed" ? "Couldn't finish: " : status === "done" ? "Finished: " : "";
  return { text: `${prefix}${last.title}`, time: last.updatedAt };
}

export function WorkerMessageList({ run, tasks }: { run: RunRecord; tasks: TaskRecord[] }) {
  const workingTask = tasks.find((t) => t.status === "running");
  const stuckTask = tasks.find((t) => t.status === "needs_retry" || t.status === "blocked");
  const activeRole = (workingTask ?? stuckTask)?.agentRole ?? (run.status === "planning" ? "manager" : null);

  return (
    <div className="glass flex h-full flex-col overflow-hidden rounded-2xl border border-white/10">
      <div className="border-b border-white/10 px-4 py-3">
        <h3 className="text-sm font-semibold text-white/85">Team</h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        {ROSTER.map((role) => {
          const meta = AGENT_META[role];
          const Icon = meta.icon;
          const roleTasks = role === "manager" ? [] : tasks.filter((t) => t.agentRole === role);
          const involved = role === "manager" || roleTasks.length > 0;
          const isActive = role === activeRole;
          const { text, time } = previewFor(role, roleTasks, run);
          const status = role === "manager" ? null : deriveStatus(roleTasks);

          return (
            <div
              key={role}
              className={`flex items-start gap-3 border-b border-white/[0.04] px-4 py-3 transition ${
                isActive ? "bg-white/[0.06]" : involved ? "" : "opacity-40"
              }`}
            >
              <div className="relative shrink-0">
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-full ${isActive ? "planet-pulse" : ""}`}
                  style={{
                    background: `${meta.color}${isActive ? "30" : "18"}`,
                    border: `1.5px solid ${meta.color}${involved ? "" : "55"}`,
                    boxShadow: isActive ? `0 0 12px 1px ${meta.color}66` : "none",
                  }}
                >
                  <Icon size={18} strokeWidth={2.25} color={meta.color} />
                </span>
                {isActive && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-black/40 bg-emerald-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-white/90">
                    {meta.name} <span className="text-white/35">· {meta.label}</span>
                  </span>
                  {time && <span className="shrink-0 text-[10px] text-white/30">{relativeTime(time)}</span>}
                </div>
                <div
                  className={`mt-0.5 truncate rounded-2xl px-2.5 py-1 text-[12px] leading-snug ${
                    isActive
                      ? "bg-accent-500/15 text-accent-100"
                      : status === "failed"
                        ? "bg-rose-500/10 text-rose-200"
                        : "bg-white/[0.05] text-white/55"
                  }`}
                >
                  {isActive && (
                    <span className="mr-1 inline-flex gap-0.5 align-middle">
                      <span className="h-1 w-1 animate-pulseSoft rounded-full bg-current" />
                      <span className="h-1 w-1 animate-pulseSoft rounded-full bg-current [animation-delay:0.15s]" />
                      <span className="h-1 w-1 animate-pulseSoft rounded-full bg-current [animation-delay:0.3s]" />
                    </span>
                  )}
                  {text}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
