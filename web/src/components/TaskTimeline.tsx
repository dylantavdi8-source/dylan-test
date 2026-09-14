import { useState } from "react";
import type { TaskRecord, RunEvent } from "../lib/types.js";
import { AGENT_META, TASK_STATUS_META } from "../lib/meta.js";

function EventRow({ event }: { event: RunEvent }) {
  const isToolCall = event.type === "task.tool_call";
  const isFlag = event.type === "task.flagged";
  const isRetry = event.type === "task.retry" || event.type === "task.blocked_resolved";
  return (
    <div className="flex gap-2 py-1 text-xs">
      <span className="shrink-0 pt-0.5 font-mono text-[10px] text-white/25">{new Date(event.createdAt).toLocaleTimeString()}</span>
      <span
        className={
          isFlag
            ? "text-amber-300"
            : isRetry
            ? "text-amber-200/80"
            : isToolCall
            ? "text-accent-400/90 font-mono"
            : event.type.includes("failed")
            ? "text-rose-300"
            : event.type.includes("completed")
            ? "text-emerald-300/90"
            : "text-white/55"
        }
      >
        {event.message}
      </span>
    </div>
  );
}

export function TaskRow({ task, events }: { task: TaskRecord; events: RunEvent[] }) {
  const [open, setOpen] = useState(false);
  const meta = AGENT_META[task.agentRole];
  const statusMeta = TASK_STATUS_META[task.status];
  const taskEvents = events.filter((e) => e.taskId === task.id);

  return (
    <div className="glass rounded-lg border border-white/10">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[9px] font-bold text-black/80" style={{ background: meta.color }}>
          {meta.short}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-white/85">{task.title}</div>
          {task.dependsOn.length > 0 && <div className="truncate text-[11px] text-white/35">depends on {task.dependsOn.join(", ")}</div>}
        </div>
        {task.attempt > 1 && <span className="shrink-0 text-[11px] text-amber-300/80">attempt {task.attempt}/{task.maxAttempts}</span>}
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${statusMeta.className}`}>{statusMeta.label}</span>
        <span className="text-white/30">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="border-t border-white/10 px-3.5 py-2.5">
          {task.feedback && task.status !== "completed" && (
            <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-1.5 text-xs text-amber-200/90">
              <span className="font-medium">Feedback: </span>
              {task.feedback}
            </div>
          )}
          {taskEvents.length > 0 ? (
            <div className="space-y-0.5">
              {taskEvents.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </div>
          ) : (
            <div className="text-xs text-white/30">No activity yet.</div>
          )}
          {task.output && (
            <div className="mt-2 rounded-md bg-black/25 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-white/60">
              <pre className="whitespace-pre-wrap break-words">{task.output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskTimeline({ tasks, events }: { tasks: TaskRecord[]; events: RunEvent[] }) {
  if (tasks.length === 0) return null;
  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} events={events} />
      ))}
    </div>
  );
}
