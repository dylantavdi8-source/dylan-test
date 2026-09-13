import { useCallback, useEffect, useState } from "react";
import { createRun, listRuns } from "./lib/api.js";
import type { RunRecord } from "./lib/types.js";
import { useRunSocket } from "./hooks/useRunSocket.js";
import { PromptInput } from "./components/PromptInput.js";
import { HistorySidebar } from "./components/HistorySidebar.js";
import { RunHeader } from "./components/RunHeader.js";
import { TeamBoard } from "./components/TeamBoard.js";
import { TaskTimeline } from "./components/TaskTimeline.js";
import { ResultPanel } from "./components/ResultPanel.js";

export default function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const state = useRunSocket(selectedId);

  const refreshHistory = useCallback(() => {
    listRuns()
      .then(setRuns)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  // Keep history in sync while a run is progressing (status/title updates).
  useEffect(() => {
    if (!state.run) return;
    const interval = setInterval(refreshHistory, 3000);
    return () => clearInterval(interval);
  }, [state.run?.status, refreshHistory]);

  const isBusy = state.run?.status === "planning" || state.run?.status === "running";

  const handleSubmit = async (prompt: string) => {
    setSubmitError(null);
    try {
      const { runId } = await createRun(prompt);
      setSelectedId(runId);
      refreshHistory();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <HistorySidebar runs={runs} selectedId={selectedId} onSelect={setSelectedId} onNew={() => setSelectedId(null)} />

      <main className="flex-1 overflow-y-auto">
        {!selectedId ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
            <div className="text-center">
              <h1 className="text-3xl font-bold tracking-tight text-white">Your eBay Team</h1>
              <p className="mt-2 max-w-md text-sm text-white/45">
                One request in. A manager agent delegates to listing, pricing, inventory, and messages
                specialists who work your real eBay account, get double-checked by compliance, and hand
                you back one honest result.
              </p>
            </div>
            <PromptInput onSubmit={handleSubmit} disabled={false} />
            {submitError && <div className="text-sm text-rose-300">{submitError}</div>}
          </div>
        ) : (
          <div className="mx-auto max-w-4xl px-6 py-8">
            {state.loading && !state.run && <div className="text-sm text-white/40">Loading run…</div>}
            {state.error && <div className="text-sm text-rose-300">{state.error}</div>}
            {state.run && (
              <>
                <RunHeader run={state.run} connected={state.connected} />
                <div className="mb-6">
                  <TeamBoard run={state.run} tasks={state.tasks} />
                </div>
                <div className="mb-6">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-white/35">Task activity</div>
                  <TaskTimeline tasks={state.tasks} events={state.events} />
                </div>
                <ResultPanel run={state.run} />
                {isBusy && (
                  <div className="mt-6 flex items-center gap-2 text-xs text-white/35">
                    <span className="h-1.5 w-1.5 animate-pulseSoft rounded-full bg-accent-400" />
                    The team is working -- this updates live.
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
