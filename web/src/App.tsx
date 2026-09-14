import { useCallback, useEffect, useRef, useState } from "react";
import { createRun, listRuns } from "./lib/api.js";
import type { RunRecord, BuyerActivity } from "./lib/types.js";
import { useRunSocket } from "./hooks/useRunSocket.js";
import { useVoiceAssistant } from "./hooks/useVoiceAssistant.js";
import { useBuyerActivityFeed } from "./hooks/useBuyerActivityFeed.js";
import { PromptInput } from "./components/PromptInput.js";
import { HistorySidebar } from "./components/HistorySidebar.js";
import { RunHeader } from "./components/RunHeader.js";
import { TeamBoard } from "./components/TeamBoard.js";
import { GalaxyView } from "./components/GalaxyView.js";
import { TaskTimeline } from "./components/TaskTimeline.js";
import { ResultPanel } from "./components/ResultPanel.js";
import { BuyerActivityToast } from "./components/BuyerActivityToast.js";
import { Mic, MicOff } from "lucide-react";

type BoardView = "galaxy" | "list";

export default function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [view, setView] = useState<BoardView>(() => (localStorage.getItem("boardView") as BoardView) || "galaxy");
  const state = useRunSocket(selectedId);

  const setViewAndPersist = (v: BoardView) => {
    setView(v);
    localStorage.setItem("boardView", v);
  };

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

  const handleSubmit = useCallback(async (prompt: string, imageDataUrl?: string, sellSpeed?: number) => {
    setSubmitError(null);
    try {
      const { runId } = await createRun(prompt, imageDataUrl, sellSpeed);
      setSelectedId(runId);
      refreshHistory();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  }, [refreshHistory]);

  const { status: voiceStatus, enable: enableVoice, disable: disableVoice, speak } = useVoiceAssistant((text) => handleSubmit(text));
  const spokenRunRef = useRef<string | null>(null);

  const [activity, setActivity] = useState<BuyerActivity | null>(null);
  useBuyerActivityFeed((a) => {
    setActivity(a);
    if (voiceStatus !== "off") {
      const summary =
        a.kind === "message"
          ? `Heads up -- new message from ${a.message.buyerUsername} about ${a.message.listingTitle ?? "a listing"}.`
          : `Heads up -- new offer of $${a.offer.offerPrice.toFixed(2)} from ${a.offer.buyerUsername} on ${a.offer.listingTitle ?? "a listing"}.`;
      speak(summary);
    }
  });

  const handleActivity = useCallback(
    (a: BuyerActivity) => {
      setActivity(null);
      const prompt =
        a.kind === "message"
          ? `Reply to the new message from ${a.message.buyerUsername} on ${a.message.sku ?? "the listing"}, then tell me what you said.`
          : `Respond to ${a.offer.buyerUsername}'s new offer of $${a.offer.offerPrice.toFixed(2)} on ${a.offer.sku}, then tell me what you decided.`;
      handleSubmit(prompt);
    },
    [handleSubmit]
  );

  // Speak the manager's final answer out loud once, the moment a run wraps up.
  useEffect(() => {
    if (!state.run) return;
    if (state.run.status !== "completed" && state.run.status !== "failed") return;
    if (spokenRunRef.current === state.run.id) return;
    spokenRunRef.current = state.run.id;
    if (state.run.status === "completed" && state.run.finalResult) {
      speak(state.run.finalResult);
    } else if (state.run.status === "failed") {
      speak(state.run.error ?? "The run failed.");
    }
  }, [state.run, speak]);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <HistorySidebar runs={runs} selectedId={selectedId} onSelect={setSelectedId} onNew={() => setSelectedId(null)} />

      <main className="flex-1 overflow-y-auto">
        {!selectedId ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
            <div className="text-center">
              <h1 className="text-3xl font-bold tracking-tight text-white">Your eBay Team</h1>
              <p className="mt-2 max-w-md text-sm text-white/45">
                Type a request, attach a photo of an item, or just say "hey galaxy". A manager agent
                delegates to listing, pricing, inventory, and messages specialists who work your real
                eBay account, get double-checked by compliance, and hand you back one honest result.
              </p>
            </div>
            <PromptInput onSubmit={handleSubmit} disabled={false} />
            {submitError && <div className="text-sm text-rose-300">{submitError}</div>}
          </div>
        ) : (
          <div className="mx-auto max-w-5xl px-6 py-8">
            {state.loading && !state.run && <div className="text-sm text-white/40">Loading run…</div>}
            {state.error && <div className="text-sm text-rose-300">{state.error}</div>}
            {state.run && (
              <>
                <RunHeader run={state.run} connected={state.connected} />
                <div className="mb-6">
                  <div className="mb-2 flex justify-end">
                    <div className="glass inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
                      <button
                        onClick={() => setViewAndPersist("galaxy")}
                        className={`rounded-md px-3 py-1.5 transition ${view === "galaxy" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}
                      >
                        ✨ Galaxy
                      </button>
                      <button
                        onClick={() => setViewAndPersist("list")}
                        className={`rounded-md px-3 py-1.5 transition ${view === "list" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}
                      >
                        List
                      </button>
                    </div>
                  </div>
                  {view === "galaxy" ? (
                    <GalaxyView run={state.run} tasks={state.tasks} voiceStatus={voiceStatus} />
                  ) : (
                    <TeamBoard run={state.run} tasks={state.tasks} />
                  )}
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

      <VoiceToggle status={voiceStatus} onEnable={enableVoice} onDisable={disableVoice} />
      {activity && <BuyerActivityToast activity={activity} onDismiss={() => setActivity(null)} onHandle={() => handleActivity(activity)} />}
    </div>
  );
}

function VoiceToggle({
  status,
  onEnable,
  onDisable,
}: {
  status: ReturnType<typeof useVoiceAssistant>["status"];
  onEnable: () => void;
  onDisable: () => void;
}) {
  if (status === "unsupported") {
    return (
      <div className="fixed bottom-5 right-5 z-30 max-w-[220px] rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-[11px] text-white/40 backdrop-blur">
        Voice needs Chrome -- try this page there for "hey galaxy".
      </div>
    );
  }

  const active = status !== "off";
  const label =
    status === "wake-listening" ? "Listening for “hey galaxy”" : status === "capturing" ? "Listening…" : status === "speaking" ? "Speaking…" : "Enable “hey galaxy”";

  return (
    <button
      onClick={active ? onDisable : onEnable}
      className={`fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full border px-4 py-2.5 text-xs font-medium shadow-glow backdrop-blur transition ${
        active
          ? "border-accent-500/40 bg-accent-500/15 text-accent-100"
          : "border-white/10 bg-black/60 text-white/60 hover:border-white/20 hover:text-white/90"
      }`}
    >
      {active ? <Mic size={15} className="animate-pulseSoft" /> : <MicOff size={15} />}
      {label}
    </button>
  );
}
