# AI Team

A working multi-agent system: one request comes in, a **Manager** agent decides which
specialists are actually needed, delegates to them, and they hand off work, challenge each
other's output, and get gated by real QA before you see one polished result.

This is a real orchestration engine, not a scripted demo -- every agent call goes through
an actual Claude tool-use loop, every file the coding/design agents produce is written to a
real sandboxed workspace on disk, and the testing agent verifies things by **actually
running commands** (`node`, `npm`, `python3`, ...) and reading their real exit codes/output.
Nothing is ever reported as "tested" or "passed" without that evidence existing.

## Architecture

```
server/   Node.js + TypeScript backend: orchestration engine, agents, sandbox, API, WebSocket
web/      React + Vite + Tailwind frontend: live "team board", task timeline, results, history
```

### The team

| Agent | Role |
|---|---|
| **Manager** | Reads your request, decides which specialists are actually needed (never runs the whole team for a simple ask), builds the task graph, and synthesizes the final answer once everything is done. |
| **Research** | Gathers/synthesizes background context and options for the rest of the team. |
| **Coding** | Writes working code into the shared workspace. |
| **Design** | Produces UI/UX specs and starter markup/CSS. |
| **Testing / QA** | Actually executes code with real commands and reports only what it observed. Never fabricates a pass. |
| **Review** | Final holistic check: does the result really satisfy the request, is there real QA evidence, are there loose ends. |

Each agent has its own system prompt (`server/src/agents/*.ts`) and its own tool
permissions (`server/src/llm/tools.ts` / `TOOLS_BY_ROLE`) -- strictly separated roles, not
one model wearing different hats.

### How a request flows

1. **Plan** -- the Manager calls `create_plan` and returns a task graph (or, for something
   trivial, answers directly with no team at all).
2. **Execute** -- the orchestrator (`server/src/orchestrator/engine.ts`) runs tasks in
   dependency order, with independent tasks running concurrently. Each task is a full
   Claude tool-use loop: the agent can read/write files, and (if it's Testing) run real
   commands, before calling `finish_task`.
3. **Hand off** -- any agent can call `handoff` to push a new task to another specialist.
4. **Challenge** -- Testing/Review can call `flag_issue` against another task's output with
   `severity: "blocking"`. That resets the flagged task (and everything downstream of it
   that already ran, so it gets re-verified) back to pending with the feedback attached, and
   it retries -- up to a per-task attempt cap.
5. **Finalize** -- once every task is done, the Manager gets the full, real history
   (including any QA exit codes) and writes one final answer. It's explicitly instructed
   never to claim something was tested without real evidence in that history.

Everything streams live over WebSocket and is persisted to SQLite, so the UI shows exactly
which agent is working, what stage the run is in, and keeps full history/logs.

### Reliability guardrails

- **Per-task retry cap** (`maxAttempts`, default 3) -- a task can only be sent back and
  retried so many times before it's marked failed and that failure cascades honestly to
  whatever depended on it.
- **Run-wide budgets** (`server/src/orchestrator/guardrails.ts`) -- a hard cap on total
  model calls, wall-clock time, and total tasks ever created in a run, so a handoff loop or
  a runaway plan can't run forever.
- **QA gating** -- a coding/design task's output only counts as reviewed once a real
  command has actually been executed against it; the Testing agent's prompt requires at
  least one `run_command` call before it can finish.
- **Honest partial failure** -- if something can't be fixed within its retry budget, the
  run doesn't pretend to succeed; the Manager is given the real failure and told to report
  it honestly rather than imply success.

### Adding another agent

1. Add `server/src/agents/<name>.ts` exporting an `AgentDefinition` (persona + step budget).
2. Register it in `server/src/agents/registry.ts`.
3. Add its tool permissions to `TOOLS_BY_ROLE` in `server/src/llm/tools.ts`.
4. Teach the Manager's planning prompt (and, if you want it exercised without an API key,
   the mock heuristic in `server/src/llm/mockProvider.ts`) when to use it.

Nothing else in the orchestrator needs to change -- task execution, handoff, retries, and
guardrails are all generic over agent role.

## Running it

```bash
npm install                         # from the repo root (installs both workspaces)
cp .env.example server/.env         # then set ANTHROPIC_API_KEY in server/.env
npm run dev:server                  # backend on :8787
npm run dev:web                     # frontend on :5173 (in another terminal)
```

Open `http://localhost:5173`.

**No `ANTHROPIC_API_KEY`?** The server automatically falls back to a deterministic, clearly
labeled mock LLM provider (you'll see a `MOCK MODE` badge in the UI and in the server log)
so the entire orchestration engine -- planning, delegation, sandboxed file writes, real
command execution, retries on real failures, guardrails, live streaming -- can still be
exercised end-to-end. Only the "what should the model decide" step is simulated; every tool
execution (file IO, running commands) is 100% real in both modes. Set the key for real agent
reasoning.

## Security notes

- `ANTHROPIC_API_KEY` is read only server-side from `server/.env` / the environment; it is
  never sent to the client.
- Each run gets its own workspace directory under `server/run-workspaces/<runId>`; file
  tools validate paths so an agent can't write outside its own run's sandbox.
- Command execution is allow-listed to a small set of interpreters/test runners
  (`node`, `npm`, `npx`, `python3`, `pip3`, `pytest`), run via `execFile` with an argv array
  (no shell interpolation) and a hard timeout. This is process-level isolation, not a full
  container sandbox -- fine for running test/build tooling against files the agents
  themselves just wrote, but not a defense against a genuinely hostile workspace.

## Project layout

```
server/src/
  agents/          persona + tool-budget per role, plus the registry
  llm/             Anthropic client, tool schemas, the mock provider
  orchestrator/    the engine: planning, task graph execution, handoff/flag/retry, guardrails
  sandbox/         per-run workspace file IO + real command execution
  db/              SQLite-backed run/task/event history
  api/, ws/        REST endpoints + WebSocket event hub
web/src/
  components/      team board, task timeline, result panel, history
  hooks/           live run state over WebSocket
  lib/             API client, shared types, status/agent display metadata
```
