import { useEffect, useRef } from "react";
import type { BuyerActivity } from "../lib/types.js";

/**
 * Run-independent feed of new buyer messages/offers as they arrive, regardless of which
 * run (if any) is currently open. Connects to the same /ws endpoint with no runId, which
 * the server routes to a separate global subscriber list (see server/src/server.ts).
 */
export function useBuyerActivityFeed(onActivity: (activity: BuyerActivity) => void): void {
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === "buyer_activity") onActivityRef.current(data.activity as BuyerActivity);
      } catch {
        // ignore malformed frames
      }
    };
    return () => ws.close();
  }, []);
}
