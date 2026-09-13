# eBay Team

A working multi-agent system for running a real eBay seller account: one request comes in, a
**Manager** agent decides which specialists are actually needed, delegates to them, and they hand
off work, catch each other's real mistakes, and hand you back one verified result.

This is a real orchestration engine, not a scripted demo -- every agent call goes through an
actual Claude tool-use loop, and every eBay action (listing changes, price/quantity updates, buyer
message replies) is a real call to eBay's API (or, without credentials configured, to a
clearly-labeled mock eBay client with a small realistic in-memory store). Nothing is ever reported
as "done" or "sent" without a real tool result saying so -- including when it was only a dry run.

## Architecture

```
server/   Node.js + TypeScript backend: orchestration engine, agents, eBay client, API, WebSocket
web/      React + Vite + Tailwind frontend: live "team board" (workers on the left, whichever
          bot is actually working spotlighted), task timeline, results, history
```

### The team

| Agent | Role |
|---|---|
| **Manager** | Reads your request, decides which specialists are actually needed (never runs the whole team for a simple ask), builds the task graph, and synthesizes the final answer once everything is done. |
| **Listing** | Creates and edits eBay listings -- title, description, category, publish, end. |
| **Pricing** | Sets/adjusts listing prices, grounded in real comparable-listing research. |
| **Inventory** | Tracks stock levels and order activity, updates listing quantities. |
| **Messages** | Reads real buyer questions and drafts/sends replies. |
| **Compliance** | Final sign-off -- verifies other agents' claims against what actually happened on eBay (a rejected price change, an inaccurate reply, a dry-run being reported honestly) before work counts as done. |

Each agent has its own system prompt (`server/src/agents/*.ts`) and its own tool permissions
(`server/src/llm/tools.ts` / `TOOLS_BY_ROLE`) -- strictly separated roles, not one model wearing
different hats.

### How a request flows

1. **Plan** -- the Manager calls `create_plan` and returns a task graph (or, for something
   trivial like a pure read-only question, answers directly with no team at all).
2. **Execute** -- the orchestrator (`server/src/orchestrator/engine.ts`) runs tasks in dependency
   order, with independent tasks running concurrently. Each task is a full Claude tool-use loop
   against real eBay tools.
3. **Hand off** -- any agent can call `handoff` to push a new task to another specialist.
4. **Challenge** -- Compliance (or any agent) can call `flag_issue` against another task's output
   with `severity: "blocking"`. That resets the flagged task (and everything downstream of it that
   already ran, so it gets re-verified) back to pending with the feedback attached, and it retries
   -- up to a per-task attempt cap. The mock eBay client ships with a real floor-price guard, so
   even in mock mode you can see a genuine rejection -> flag -> corrected retry -> success cycle,
   not a scripted one.
5. **Finalize** -- once every task is done, the Manager gets the full, real history (including
   which actions actually succeeded, were rejected, or only ran as a dry run) and writes one final
   answer. It's explicitly instructed never to claim an eBay action happened without real evidence
   in that history.

Everything streams live over WebSocket and is persisted to SQLite, so the UI shows exactly which
agent is working, what stage the run is in, and keeps full history/logs.

### Safety: dry run vs. live

Every action that would change something real (create/update/end a listing, change price or
quantity, send a buyer a message) checks an independent safety gate before doing anything:

- **`EBAY_LIVE_MODE=false` (default)**: even with real eBay credentials configured, mutating
  actions are simulated -- the agent gets a realistic tool result labeled `dryRun: true`, and
  nothing is actually sent to eBay.
- **`EBAY_LIVE_MODE=true`**: mutating actions are real. Set this only after you've verified
  behavior against `EBAY_ENV=sandbox`.

Read-only actions (listing/order/message lookups, comparable-listing search) are unaffected by
this flag and run for real as soon as credentials exist, since they can't change anything.

The UI shows exactly which mode a run was in: `MOCK EBAY` (no credentials), `DRY RUN` (credentials
configured, live mode off), or `LIVE EBAY` (live mode on -- real actions against your real store).

### Reliability guardrails

- **Per-task retry cap** (`maxAttempts`, default 3) -- a task can only be sent back and retried so
  many times before it's marked failed and that failure cascades honestly to whatever depended on it.
- **Run-wide budgets** (`server/src/orchestrator/guardrails.ts`) -- a hard cap on total model
  calls, wall-clock time, and total tasks ever created in a run, so a handoff loop or a runaway
  plan can't run forever.
- **Compliance gating** -- the Manager's planning prompt is instructed to follow any task that
  changes something real with a Compliance task that depends on it.
- **Honest partial failure** -- if something can't be fixed within its retry budget, the run
  doesn't pretend to succeed; the Manager is given the real failure and told to report it honestly.

### Adding another agent

1. Add `server/src/agents/<name>.ts` exporting an `AgentDefinition` (persona + step budget).
2. Register it in `server/src/agents/registry.ts` and add it to the `AgentRole` union in
   `server/src/types.ts` (and mirror it in `web/src/lib/types.ts` + `web/src/lib/meta.ts` for the UI).
3. Add its tool permissions to `TOOLS_BY_ROLE` in `server/src/llm/tools.ts`.
4. Teach the Manager's planning prompt (`server/src/agents/manager.ts`) and, if you want it
   exercised without an API key, the mock heuristic in `server/src/llm/mockProvider.ts` when to use it.

Nothing else in the orchestrator needs to change -- task execution, handoff, retries, and
guardrails are all generic over agent role.

## Running it

```bash
npm install                         # from the repo root (installs both workspaces)
cp .env.example server/.env         # then set ANTHROPIC_API_KEY and/or eBay credentials
npm run dev:server                  # backend on :8787
npm run dev:web                     # frontend on :5173 (in another terminal)
```

Open `http://localhost:5173`.

**No `ANTHROPIC_API_KEY`?** The server falls back to a deterministic, clearly-labeled mock LLM
provider so the whole orchestration engine can still be exercised end-to-end.

**No eBay credentials?** The server falls back to a clearly-labeled mock eBay client -- a small
in-memory store of realistic fake listings, orders, and buyer messages, including one listing with
a floor price that a lowball price change will genuinely get rejected against. See `.env.example`
for exactly what's needed and how to get it (a one-time OAuth consent flow through eBay's own
developer portal that can't be automated from here).

## Security notes

- `ANTHROPIC_API_KEY` and the eBay credentials are read only server-side (`server/.env` /
  environment); none of them are ever sent to the client.
- Mutating eBay actions are gated behind `EBAY_LIVE_MODE` regardless of whether credentials are
  configured -- see "Safety" above.
- The Trading API call used for buyer messages (there's no modern REST equivalent for this) was
  built against eBay's documented OAuth migration path but could not be verified against a live
  account in the session that wrote it -- verify in `EBAY_ENV=sandbox` before relying on it, and
  see the comment in `server/src/ebay/realClient.ts` if it errors on auth.

## Project layout

```
server/src/
  agents/          persona + tool-budget per role, plus the registry
  ebay/            the eBay integration: shared types, real client (REST + Trading API), mock client
  llm/             Anthropic client, tool schemas, the mock LLM provider
  orchestrator/    the engine: planning, task graph execution, handoff/flag/retry, guardrails
  db/              SQLite-backed run/task history
  api/, ws/        REST endpoints + WebSocket event hub
web/src/
  components/      team board (workers on the left, active bot spotlighted), task timeline,
                    result panel, history
  hooks/           live run state over WebSocket
  lib/             API client, shared types, status/agent display metadata
```
