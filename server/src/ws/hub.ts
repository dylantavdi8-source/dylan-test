import type { WebSocket } from "ws";
import type { RunEvent } from "../types.js";
import type { BuyerActivity } from "../ebay/mockClient.js";

const subscribers = new Map<string, Set<WebSocket>>();

export function subscribe(runId: string, socket: WebSocket): void {
  if (!subscribers.has(runId)) subscribers.set(runId, new Set());
  subscribers.get(runId)!.add(socket);
  socket.on("close", () => {
    subscribers.get(runId)?.delete(socket);
    if (subscribers.get(runId)?.size === 0) subscribers.delete(runId);
  });
}

export function publish(runId: string, event: RunEvent): void {
  const set = subscribers.get(runId);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify({ type: "event", event });
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

// A separate, run-independent feed: clients connect to it (no runId) to hear about new
// buyer messages/offers as they arrive, regardless of which run (if any) they're viewing.
const globalSubscribers = new Set<WebSocket>();

export function subscribeGlobal(socket: WebSocket): void {
  globalSubscribers.add(socket);
  socket.on("close", () => globalSubscribers.delete(socket));
}

export function publishBuyerActivity(activity: BuyerActivity): void {
  if (globalSubscribers.size === 0) return;
  const payload = JSON.stringify({ type: "buyer_activity", activity });
  for (const ws of globalSubscribers) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}
