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
import { subscribe } from "./ws/hub.js";
import { store } from "./db/db.js";
import { getLlmProvider } from "./llm/client.js";

const PORT = Number(process.env.PORT ?? 8787);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
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
      ws.close(1008, "runId query param is required");
      return;
    }
    subscribe(runId, ws);
    // Catch the client up on everything that already happened before it connected.
    const events = store.listEventsForRun(runId);
    ws.send(JSON.stringify({ type: "snapshot", events }));
  });
});

httpServer.listen(PORT, () => {
  const mode = getLlmProvider().mode;
  console.log(`[ai-team] server listening on http://localhost:${PORT} (LLM mode: ${mode.toUpperCase()})`);
  if (mode === "mock") {
    console.log("[ai-team] ANTHROPIC_API_KEY not set -- running with the deterministic mock LLM provider. Set it in .env for real agent reasoning.");
  }
});
