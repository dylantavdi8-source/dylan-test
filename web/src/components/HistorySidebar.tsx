import type { RunRecord } from "../lib/types.js";
import { RUN_STATUS_META, relativeTime } from "../lib/meta.js";

export function HistorySidebar({
  runs,
  selectedId,
  onSelect,
  onNew,
}: {
  runs: RunRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-white/10 bg-white/[0.015]">
      <div className="p-3">
        <button
          onClick={onNew}
          className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/85 transition hover:bg-white/[0.08]"
        >
          + New request
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        <div className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-white/30">History</div>
        {runs.length === 0 && <div className="px-2 py-3 text-xs text-white/30">No runs yet.</div>}
        <div className="space-y-1">
          {runs.map((r) => {
            const meta = RUN_STATUS_META[r.status];
            const active = r.id === selectedId;
            return (
              <button
                key={r.id}
                onClick={() => onSelect(r.id)}
                className={`block w-full rounded-lg px-2.5 py-2 text-left transition ${
                  active ? "bg-accent-500/15 ring-1 ring-accent-500/40" : "hover:bg-white/[0.04]"
                }`}
              >
                <div className="truncate text-[13px] text-white/80">{r.prompt}</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${meta.className}`}>{meta.label}</span>
                  <span className="text-[10px] text-white/30">{relativeTime(r.createdAt)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
