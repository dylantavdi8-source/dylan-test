import type { AgentRole, TaskRecord, RunRecord } from "../lib/types.js";
import { AgentCard, currentTaskFor } from "./AgentCard.js";
import { AGENT_META } from "../lib/meta.js";

const WORKER_ORDER: AgentRole[] = ["listing", "pricing", "inventory", "messages", "compliance"];

function ManagerRosterCard({ run, active }: { run: RunRecord; active: boolean }) {
  const meta = AGENT_META.manager;
  const Icon = meta.icon;
  return (
    <div className={`glass relative flex items-center gap-3 rounded-xl border p-3 transition-all ${active ? "border-amber-500/50 shadow-glow bg-white/[0.04]" : "border-white/10"}`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${meta.color}22`, color: meta.color }}>
        <Icon size={18} strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-white/90">Manager</span>
          <span className={`flex shrink-0 items-center gap-1.5 text-[10px] ${active ? "text-amber-300" : "text-emerald-300"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-amber-400 animate-pulseSoft" : "bg-emerald-400"}`} />
            {active ? "Orchestrating" : "Delegated"}
          </span>
        </div>
        <div className="truncate text-[11px] text-white/40">{meta.blurb}</div>
      </div>
    </div>
  );
}

export function TeamBoard({ run, tasks }: { run: RunRecord; tasks: TaskRecord[] }) {
  const activeRoles = WORKER_ORDER.filter((r) => tasks.some((t) => t.agentRole === r));
  const managerBusy = run.status === "planning" || (run.status === "running" && tasks.every((t) => t.status === "completed"));
  const workingTask = tasks.find((t) => t.status === "running");
  const stuckTask = tasks.find((t) => t.status === "needs_retry" || t.status === "blocked");
  const spotlightTask = workingTask ?? stuckTask;

  if (activeRoles.length === 0) {
    return (
      <div className="glass rounded-xl border border-white/10 p-4 text-sm text-white/60">
        The manager handled this directly -- no specialist agents were needed.
      </div>
    );
  }

  const completed = tasks.filter((t) => t.status === "completed");
  const failed = tasks.filter((t) => t.status === "failed");
  const lastCompleted = [...completed].sort((a, b) => b.updatedAt - a.updatedAt)[0];

  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      {/* Workers, on the left */}
      <div className="flex shrink-0 flex-col gap-2 lg:w-[260px]">
        <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-white/30">Team</div>
        <ManagerRosterCard run={run} active={managerBusy} />
        {activeRoles.map((role) => (
          <AgentCard key={role} role={role} tasks={tasks.filter((t) => t.agentRole === role)} />
        ))}
      </div>

      {/* Spotlight: whichever bot is actually working right now */}
      <div className="glass flex-1 rounded-xl border border-white/10 p-5">
        {managerBusy ? (
          <SpotlightManager run={run} />
        ) : spotlightTask ? (
          <SpotlightWorker task={spotlightTask} />
        ) : (
          <SpotlightIdle run={run} completed={completed.length} failed={failed.length} lastCompleted={lastCompleted} />
        )}
      </div>
    </div>
  );
}

function SpotlightHeader({ role, statusLabel, statusClass, dotClass }: { role: AgentRole | "manager"; statusLabel: string; statusClass: string; dotClass: string }) {
  const meta = AGENT_META[role];
  const Icon = meta.icon;
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-2xl shadow-glow"
          style={{ background: `${meta.color}22`, color: meta.color }}
        >
          <Icon size={24} strokeWidth={2.25} />
        </span>
        <div>
          <div className="text-base font-semibold text-white/95">{meta.label}</div>
          <div className="text-xs text-white/40">{meta.blurb}</div>
        </div>
      </div>
      <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${statusClass}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        {statusLabel}
      </span>
    </div>
  );
}

function SpotlightManager({ run }: { run: RunRecord }) {
  const label = run.status === "planning" ? "Planning" : "Synthesizing";
  return (
    <>
      <SpotlightHeader role="manager" statusLabel={label} statusClass="text-amber-300 bg-amber-500/10 border-amber-500/30" dotClass="bg-amber-400 animate-pulseSoft" />
      <p className="text-sm leading-relaxed text-white/60">
        {run.status === "planning"
          ? "Reading the request and deciding which specialists are actually needed for it."
          : "All specialist work is done -- pulling it together into one final, honest answer."}
      </p>
    </>
  );
}

function SpotlightWorker({ task }: { task: TaskRecord }) {
  const isRetry = task.status === "needs_retry" || task.status === "blocked";
  return (
    <>
      <SpotlightHeader
        role={task.agentRole}
        statusLabel={isRetry ? "Retrying" : "Working"}
        statusClass={isRetry ? "text-amber-300 bg-amber-500/10 border-amber-500/30" : "text-accent-400 bg-accent-500/10 border-accent-500/30"}
        dotClass={isRetry ? "bg-amber-400 animate-pulseSoft" : "bg-accent-400 animate-pulseSoft"}
      />
      <div className="text-sm font-medium text-white/85">{task.title}</div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-white/55">{task.instructions}</p>
      {task.feedback && (
        <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-200/90">
          <span className="font-medium">Retry feedback:</span> {task.feedback}
        </div>
      )}
      {task.attempt > 1 && (
        <div className="mt-3 text-[11px] text-white/30">Attempt {task.attempt} of {task.maxAttempts}</div>
      )}
    </>
  );
}

function SpotlightIdle({ run, completed, failed, lastCompleted }: { run: RunRecord; completed: number; failed: number; lastCompleted?: TaskRecord }) {
  const done = run.status === "completed" || run.status === "failed";
  return (
    <>
      <div className="mb-3 text-sm font-medium text-white/80">
        {done ? "Run finished" : "Waiting for the next task to start"}
      </div>
      <div className="flex items-center gap-4 text-xs text-white/50">
        <span className="text-emerald-300">{completed} completed</span>
        {failed > 0 && <span className="text-rose-300">{failed} failed</span>}
      </div>
      {lastCompleted && (
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-white/30">Last completed</div>
          <div className="mt-1 text-sm text-white/70">{lastCompleted.title}</div>
        </div>
      )}
    </>
  );
}
