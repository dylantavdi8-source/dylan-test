import { useCallback, useEffect, useRef, useState } from "react";
import { getRun } from "../lib/api.js";
import type { RunRecord, TaskRecord, RunEvent } from "../lib/types.js";

export interface RunState {
  run: RunRecord | null;
  tasks: TaskRecord[];
  events: RunEvent[];
  loading: boolean;
  error: string | null;
  connected: boolean;
}

const EMPTY_STATE: RunState = { run: null, tasks: [], events: [], loading: false, error: null, connected: false };

/**
 * Live view of one run. Fetches the full run/task/event snapshot over REST, then keeps
 * it fresh by refetching (debounced) whenever the WebSocket signals something changed --
 * simpler and more robust than reducing a partial client-side task model from the raw
 * event stream, and the payload is small enough that this stays cheap.
 */
export function useRunSocket(runId: string | null): RunState {
  const [state, setState] = useState<RunState>(EMPTY_STATE);

  const refresh = useCallback(async (id: string) => {
    try {
      const data = await getRun(id);
      setState((s) => ({ ...s, run: data.run, tasks: data.tasks, events: data.events, loading: false, error: null }));
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : String(err) }));
    }
  }, []);

  useEffect(() => {
    if (!runId) {
      setState(EMPTY_STATE);
      return;
    }
    setState({ ...EMPTY_STATE, loading: true });
    refresh(runId);

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws?runId=${encodeURIComponent(runId)}`);
    let debounce: ReturnType<typeof setTimeout> | null = null;

    ws.onopen = () => setState((s) => ({ ...s, connected: true }));
    ws.onclose = () => setState((s) => ({ ...s, connected: false }));
    ws.onmessage = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => refresh(runId), 100);
    };

    return () => {
      if (debounce) clearTimeout(debounce);
      ws.close();
    };
  }, [runId, refresh]);

  return state;
}
