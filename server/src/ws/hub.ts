import type { WebSocket } from "ws";
import type { RunEvent } from "../types.js";

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
