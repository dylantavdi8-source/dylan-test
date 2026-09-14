import { existsSync } from "node:fs";
// Loads server/.env (cwd-relative) if present. Experimental Node API (20.6+/22.x) --
// falls back to silently doing nothing so real environment variables still work.
try {
  if (existsSync(".env")) {
    // @ts-ignore
    process.loadEnvFile(".env");
  }
} catch {
  /* no .env present or API unavailable -- fine, rely on real env vars */
}

import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { URL } from "node:url";
import { router } from "./api/routes.js";
import { subscribe, subscribeGlobal, publishBuyerActivity } from "./ws/hub.js";
import { store } from "./db/db.js";
import { getLlmProvider } from "./llm/client.js";
import { getEbayClient } from "./ebay/index.js";
import { injectRandomBuyerActivity } from "./ebay/mockClient.js";

const PORT = Number(process.env.PORT ?? 8787);

const app = express();
app.use(cors());
app.use(express.json({ limit: "12mb" }));
app.use("/api", router);

const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "", "http://localhost");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const runId = url.searchParams.get("runId");
    if (!runId) {
      // No runId -- this is the run-independent "buyer activity" feed.
      subscribeGlobal(ws);
      return;
    }
    subscribe(runId, ws);
    // Catch the client up on everything that already happened before it connected.
    const events = store.listEventsForRun(runId);
    ws.send(JSON.stringify({ type: "snapshot", events }));
  });
});

// Simulates buyer activity arriving over time in the mock eBay world (which is otherwise
// static) so the "notify me when a buyer reaches out" flow has something real to react to.
// Only meaningful in mock mode -- a live eBay account already has its own real activity.
if (getEbayClient().mode === "mock") {
  const ACTIVITY_INTERVAL_MS = 45_000;
  setInterval(() => {
    const activity = injectRandomBuyerActivity();
    if (activity) publishBuyerActivity(activity);
  }, ACTIVITY_INTERVAL_MS);
}

httpServer.listen(PORT, () => {
  const mode = getLlmProvider().mode;
  console.log(`[ai-team] server listening on http://localhost:${PORT} (LLM mode: ${mode.toUpperCase()})`);
  if (mode === "mock") {
    console.log("[ai-team] ANTHROPIC_API_KEY not set -- running with the deterministic mock LLM provider. Set it in .env for real agent reasoning.");
  }
});
