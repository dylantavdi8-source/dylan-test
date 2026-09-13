import { nanoid } from "nanoid";
import { store } from "../db/db.js";
import { createWorkspace } from "../sandbox/workspace.js";
import { getLlmProvider } from "../llm/client.js";
import {
  toolsForRole,
  TOOL_SCHEMAS,
  CreatePlanInput,
  FinishRunInput,
  FinishTaskInput,
  HandoffInput,
  FlagIssueInput,
} from "../llm/tools.js";
import { buildSystemPrompt, agentDef } from "../agents/registry.js";
import { buildPlanningContext, buildFinalizeContext, buildTaskContext } from "./contextBuilder.js";
import { executeWorkspaceTool } from "./toolExecutor.js";
import { runToolLoop } from "./agentRunner.js";
import { RunGuardrails } from "./guardrails.js";
import { publish } from "../ws/hub.js";
import type { RunRecord, TaskRecord, RunEvent, RunEventType, AgentRole, PlanTaskInput } from "../types.js";

const TASK_CONCURRENCY = 3;
const DEFAULT_MAX_ATTEMPTS = 3;

function emit(runId: string, taskId: string | null, type: RunEventType, agentRole: AgentRole | null, message: string, data?: unknown): void {
  const event: RunEvent = { id: nanoid(), runId, taskId, type, agentRole, message, data: data ?? null, createdAt: Date.now() };
  store.addEvent(event);
  publish(runId, event);
}

export async function startRun(prompt: string): Promise<string> {
  const runId = nanoid();
  const now = Date.now();
  const llm = getLlmProvider();
  const workspaceDir = createWorkspace(runId);

  const run: RunRecord = {
    id: runId,
    prompt,
    status: "planning",
    createdAt: now,
    updatedAt: now,
    finalResult: null,
    workspaceDir,
    llmMode: llm.mode,
    error: null,
  };
  store.createRun(run);
  emit(
    runId,
    null,
    "run.created",
    null,
    llm.mode === "mock"
      ? "Run created. MOCK MODE: no ANTHROPIC_API_KEY is configured, so agent decisions are simulated deterministically -- tool execution (files, commands) is still 100% real."
      : "Run created.",
    { llmMode: llm.mode }
  );

  executeRun(runId, prompt, workspaceDir).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    store.updateRun(runId, { status: "failed", error: message });
    emit(runId, null, "run.failed", null, `Run crashed unexpectedly: ${message}`);
  });

  return runId;
}

async function executeRun(runId: string, prompt: string, workspaceDir: string): Promise<void> {
  const guardrails = new RunGuardrails();

  emit(runId, null, "run.planning", "manager", "Manager is analyzing the request and deciding which specialists are needed.");
  const plan = await runManagerPlanning(runId, prompt, guardrails);

  if (plan.tasks.length === 0) {
    store.updateRun(runId, { status: "completed", finalResult: plan.directAnswer ?? "No response was produced." });
    emit(runId, null, "run.completed", "manager", "Handled directly by the manager -- no specialist team was needed for this request.");
    return;
  }

  for (const t of plan.tasks) {
    const guard = guardrails.checkBeforeTaskCreate();
    if (!guard.ok) {
      emit(runId, null, "guardrail.triggered", "manager", guard.reason);
      break;
    }
    const rec: TaskRecord = {
      id: t.id,
      runId,
      agentRole: t.agentRole,
      title: t.title,
      instructions: t.instructions,
      dependsOn: t.dependsOn,
      status: "pending",
      attempt: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      output: null,
      feedback: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.createTask(rec);
    emit(runId, rec.id, "task.created", rec.agentRole, `Task created: ${rec.title}`, { dependsOn: rec.dependsOn });
  }

  const createdTasks = store.listTasksForRun(runId);
  emit(
    runId,
    null,
    "run.plan_ready",
    "manager",
    `Plan ready: ${createdTasks.length} task(s) across ${new Set(createdTasks.map((t) => t.agentRole)).size} agent(s).`,
    { tasks: createdTasks.map((t) => ({ id: t.id, title: t.title, agentRole: t.agentRole, dependsOn: t.dependsOn })) }
  );
  store.updateRun(runId, { status: "running" });

  await runTaskGraph(runId, prompt, workspaceDir, guardrails);

  const finalTasks = store.listTasksForRun(runId);
  const completed = finalTasks.filter((t) => t.status === "completed");
  const failed = finalTasks.filter((t) => t.status === "failed");

  if (completed.length === 0 && failed.length > 0) {
    store.updateRun(runId, { status: "failed", error: "All tasks failed before any usable result was produced." });
    emit(runId, null, "run.failed", null, "All tasks failed; no usable result was produced.");
    return;
  }

  emit(runId, null, "agent.message", "manager", "All work is done; the manager is synthesizing the final result.");
  const finalResult = await runManagerFinalize(runId, prompt, finalTasks, guardrails);
  store.updateRun(runId, { status: "completed", finalResult });
  emit(runId, null, "run.completed", "manager", "Run completed.");
}

// ---------------------------------------------------------------------------
// Manager planning / finalize
// ---------------------------------------------------------------------------

async function runManagerPlanning(
  runId: string,
  prompt: string,
  guardrails: RunGuardrails
): Promise<{ tasks: PlanTaskInput[]; directAnswer?: string }> {
  const result = await runToolLoop({
    system: buildSystemPrompt("manager"),
    initialUserText: buildPlanningContext(prompt),
    tools: [TOOL_SCHEMAS.create_plan],
    maxTurns: agentDef("manager").maxToolTurns,
    terminalToolNames: ["create_plan"],
    guardrails,
    executeTool: async (name, input) => executeWorkspaceTool(workspaceDirNotUsed(), name, input),
    onToolUse: (tu) => emit(runId, null, "task.tool_call", "manager", `Manager called ${tu.name}`, tu),
  });

  if (!result.terminal) {
    emit(runId, null, "guardrail.triggered", "manager", `Manager did not produce a plan (${result.stoppedReason}); falling back to a direct response.`);
    return {
      tasks: [],
      directAnswer:
        "The manager agent could not produce a task plan within its step budget. Please try again or rephrase the request.",
    };
  }

  const parsed = CreatePlanInput.parse(result.terminal.input);
  const tasks: PlanTaskInput[] = parsed.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    agentRole: t.agent_role,
    instructions: t.instructions,
    dependsOn: t.depends_on,
  }));
  return { tasks, directAnswer: parsed.direct_answer };
}

async function runManagerFinalize(runId: string, prompt: string, tasks: TaskRecord[], guardrails: RunGuardrails): Promise<string> {
  const completed = tasks.filter((t) => t.status === "completed");
  const failed = tasks.filter((t) => t.status === "failed");

  const result = await runToolLoop({
    system: buildSystemPrompt("manager"),
    initialUserText: buildFinalizeContext(
      prompt,
      completed.map((t) => ({ id: t.id, title: t.title, agentRole: t.agentRole, output: t.output ?? "" })),
      failed.map((t) => ({ id: t.id, title: t.title, agentRole: t.agentRole, feedback: t.feedback }))
    ),
    tools: [TOOL_SCHEMAS.finish_run],
    maxTurns: agentDef("manager").maxToolTurns,
    terminalToolNames: ["finish_run"],
    guardrails,
    executeTool: async (name, input) => executeWorkspaceTool(workspaceDirNotUsed(), name, input),
    onToolUse: (tu) => emit(runId, null, "task.tool_call", "manager", `Manager called ${tu.name}`, tu),
  });

  if (!result.terminal) {
    return buildFallbackSummary(completed, failed);
  }
  return FinishRunInput.parse(result.terminal.input).final_result;
}

function buildFallbackSummary(completed: TaskRecord[], failed: TaskRecord[]): string {
  const lines = completed.map((t) => `- **${t.title}** (${t.agentRole}): ${t.output}`);
  const failLines = failed.map((t) => `- **${t.title}** (${t.agentRole}): FAILED -- ${t.feedback ?? "no reason recorded"}`);
  return [
    "_The manager could not synthesize a final summary within its step budget; showing the raw completed work instead._",
    "",
    "## Completed",
    ...(lines.length ? lines : ["(none)"]),
    ...(failLines.length ? ["", "## Failed", ...failLines] : []),
  ].join("\n");
}

function workspaceDirNotUsed(): string {
  // create_plan / finish_run never touch the filesystem; executeWorkspaceTool only uses
  // this for write_file/read_file/list_files/run_command, none of which those two tools are.
  return "";
}

// ---------------------------------------------------------------------------
// Task graph execution
// ---------------------------------------------------------------------------

async function runTaskGraph(runId: string, prompt: string, workspaceDir: string, guardrails: RunGuardrails): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const tasks = store.listTasksForRun(runId);
    const byId = new Map(tasks.map((t) => [t.id, t]));

    let cascaded = false;
    for (const t of tasks) {
      if (t.status === "pending" && t.dependsOn.some((depId) => byId.get(depId)?.status === "failed")) {
        store.updateTask(runId, t.id, { status: "failed", feedback: "A dependency failed, so this task cannot proceed." });
        emit(runId, t.id, "task.failed", t.agentRole, `${t.title}: a dependency failed, cannot proceed.`);
        cascaded = true;
      }
    }
    if (cascaded) continue;

    const guard = guardrails.status();
    if (!guard.ok) {
      const stuck = tasks.filter((t) => t.status === "pending" || t.status === "running");
      for (const t of stuck) {
        if (t.status === "pending") {
          store.updateTask(runId, t.id, { status: "failed", feedback: guard.reason });
          emit(runId, t.id, "task.failed", t.agentRole, `${t.title}: ${guard.reason}`);
        }
      }
      emit(runId, null, "guardrail.triggered", null, guard.reason);
      return;
    }

    const runnable = tasks.filter((t) => t.status === "pending" && t.dependsOn.every((depId) => byId.get(depId)?.status === "completed"));

    if (runnable.length === 0) {
      const stillPending = tasks.some((t) => t.status === "pending");
      if (!stillPending) return;
      for (const t of tasks.filter((t) => t.status === "pending")) {
        store.updateTask(runId, t.id, { status: "failed", feedback: "Unresolvable dependency graph (cycle or missing dependency)." });
        emit(runId, t.id, "task.failed", t.agentRole, `${t.title}: unresolvable dependency graph.`);
      }
      return;
    }

    const batch = runnable.slice(0, TASK_CONCURRENCY);
    await Promise.all(batch.map((t) => runSingleTask(runId, prompt, workspaceDir, t, guardrails)));
  }
}

async function runSingleTask(runId: string, prompt: string, workspaceDir: string, task: TaskRecord, guardrails: RunGuardrails): Promise<void> {
  const attemptNumber = task.attempt + 1;
  store.updateTask(runId, task.id, { status: "running", attempt: attemptNumber });
  const freshTask = store.getTask(runId, task.id)!;

  emit(
    runId,
    task.id,
    "task.started",
    task.agentRole,
    `${agentDef(task.agentRole).displayName} started: ${task.title}${attemptNumber > 1 ? ` (attempt ${attemptNumber}/${task.maxAttempts})` : ""}`
  );

  const allTasks = store.listTasksForRun(runId);
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const dependencyOutputs = task.dependsOn.map((id) => byId.get(id)).filter((t): t is TaskRecord => !!t && t.status === "completed");

  const selfBlockingFlags: string[] = [];

  const result = await runToolLoop({
    system: buildSystemPrompt(task.agentRole),
    initialUserText: buildTaskContext({ prompt, task: freshTask, allTasks, dependencyOutputs }),
    tools: toolsForRole(task.agentRole),
    maxTurns: agentDef(task.agentRole).maxToolTurns,
    terminalToolNames: ["finish_task", "handoff"],
    guardrails,
    executeTool: async (name, input) => {
      if (name === "flag_issue") {
        const parsed = FlagIssueInput.parse(input);
        handleFlagIssue(runId, task, parsed);
        if (parsed.severity === "blocking" && task.dependsOn.includes(parsed.target_task_id)) {
          selfBlockingFlags.push(parsed.target_task_id);
        }
        return JSON.stringify({ ok: true, acknowledged: "flag_issue" });
      }
      return executeWorkspaceTool(workspaceDir, name, input);
    },
    onToolUse: (tu) => emit(runId, task.id, "task.tool_call", task.agentRole, `${agentDef(task.agentRole).displayName} called ${tu.name}`, tu),
  });

  if (!result.terminal) {
    if (attemptNumber < task.maxAttempts) {
      store.updateTask(runId, task.id, { status: "pending", feedback: `Previous attempt did not finish within its step budget (${result.stoppedReason}); retrying.` });
      emit(runId, task.id, "task.retry", task.agentRole, `${task.title}: retrying after not finishing within its step budget.`);
    } else {
      store.updateTask(runId, task.id, { status: "failed", feedback: `Exceeded step budget on all ${task.maxAttempts} attempts (${result.stoppedReason}).` });
      emit(runId, task.id, "task.failed", task.agentRole, `${task.title}: exceeded step budget on all attempts.`);
    }
    return;
  }

  if (result.terminal.name === "finish_task") {
    const parsed = FinishTaskInput.parse(result.terminal.input);
    if (selfBlockingFlags.length > 0) {
      // This agent flagged one of its own dependencies as blocking -- its own verdict is
      // stale until that dependency is corrected and re-completes, so stay pending instead
      // of completing; it will automatically re-run once the flagged dependency is fixed.
      store.updateTask(runId, task.id, { status: "pending", output: parsed.output, feedback: null });
      emit(runId, task.id, "task.blocked_resolved", task.agentRole, `${task.title}: ${parsed.summary} (will re-run once the flagged dependency is corrected).`, {
        output: parsed.output,
      });
    } else {
      store.updateTask(runId, task.id, { status: "completed", output: parsed.output, feedback: null });
      emit(runId, task.id, "task.completed", task.agentRole, `${task.title}: ${parsed.summary}`, { output: parsed.output });
    }
    return;
  }

  if (result.terminal.name === "handoff") {
    const parsed = HandoffInput.parse(result.terminal.input);
    store.updateTask(runId, task.id, { status: "completed", output: `Handed off to ${parsed.to_agent}: ${parsed.message}`, feedback: null });
    emit(runId, task.id, "task.completed", task.agentRole, `${task.title}: handed off to ${parsed.to_agent}.`);
    emit(runId, task.id, "task.handoff", task.agentRole, `${task.title}: handing off to ${parsed.to_agent}.`, parsed);

    const guard = guardrails.checkBeforeTaskCreate();
    if (!guard.ok) {
      emit(runId, task.id, "guardrail.triggered", task.agentRole, guard.reason);
      return;
    }
    const newTask: TaskRecord = {
      id: `${task.id}-h${Date.now().toString(36)}`,
      runId,
      agentRole: parsed.to_agent,
      title: `Handoff from ${agentDef(task.agentRole).displayName}: ${task.title}`,
      instructions: parsed.message,
      dependsOn: [task.id],
      status: "pending",
      attempt: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      output: null,
      feedback: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.createTask(newTask);
    emit(runId, newTask.id, "task.created", newTask.agentRole, `Task created via handoff: ${newTask.title}`, { dependsOn: newTask.dependsOn });
  }
}

function handleFlagIssue(runId: string, flaggingTask: TaskRecord, flag: { target_task_id: string; message: string; severity: "minor" | "blocking" }): void {
  const target = store.getTask(runId, flag.target_task_id);
  if (!target || target.runId !== runId) {
    emit(runId, flaggingTask.id, "task.flagged", flaggingTask.agentRole, `Flag referenced an unknown task (${flag.target_task_id}); ignored.`, flag);
    return;
  }

  emit(runId, target.id, "task.flagged", flaggingTask.agentRole, `${flaggingTask.title} flagged "${target.title}" as ${flag.severity}: ${flag.message}`, flag);

  if (flag.severity !== "blocking") return;
  if (target.status !== "completed" && target.status !== "failed") return; // already in flight, don't double-reset

  if (target.attempt >= target.maxAttempts) {
    store.updateTask(runId, target.id, {
      status: "failed",
      feedback: `Exceeded max retries (${target.maxAttempts}) after repeated blocking flags. Last flag: ${flag.message}`,
    });
    emit(runId, target.id, "task.failed", target.agentRole, `${target.title}: exceeded max retries after repeated blocking flags.`);
    cascadeResetDownstream(runId, target.id, true);
    return;
  }

  store.updateTask(runId, target.id, { status: "pending", feedback: flag.message });
  emit(runId, target.id, "task.retry", target.agentRole, `${target.title}: sent back for retry (attempt ${target.attempt + 1}/${target.maxAttempts}).`);
  cascadeResetDownstream(runId, target.id, false);
}

function cascadeResetDownstream(runId: string, resetTaskId: string, upstreamFailed: boolean): void {
  const tasks = store.listTasksForRun(runId);
  const dependents = tasks.filter((t) => t.dependsOn.includes(resetTaskId) && (t.status === "completed" || t.status === "failed"));
  for (const dep of dependents) {
    if (upstreamFailed) {
      store.updateTask(runId, dep.id, { status: "failed", feedback: `Upstream dependency ${resetTaskId} failed.` });
      emit(runId, dep.id, "task.failed", dep.agentRole, `${dep.title}: upstream dependency failed.`);
    } else {
      store.updateTask(runId, dep.id, { status: "pending", feedback: null });
      emit(runId, dep.id, "task.blocked_resolved", dep.agentRole, `${dep.title}: will re-run because an upstream dependency (${resetTaskId}) was corrected.`);
    }
    cascadeResetDownstream(runId, dep.id, upstreamFailed);
  }
}
