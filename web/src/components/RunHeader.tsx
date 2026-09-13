import type { RunRecord } from "../lib/types.js";
import { RUN_STATUS_META } from "../lib/meta.js";

export function RunHeader({ run, connected }: { run: RunRecord; connected: boolean }) {
  const meta = RUN_STATUS_META[run.status];
  return (
    <div className="mb-4">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-semibold leading-snug text-white/95">{run.prompt}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {run.llmMode === "mock" && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300" title="No ANTHROPIC_API_KEY configured -- agent decisions are simulated, tool execution is real.">
              MOCK MODE
            </span>
          )}
          <span className={`rounded-full border px-2.5 py-0.5 text-xs ${meta.className}`}>{meta.label}</span>
          <span className="flex items-center gap-1 text-[11px] text-white/30">
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-white/20"}`} />
            {connected ? "live" : "offline"}
          </span>
        </div>
      </div>
    </div>
  );
}
