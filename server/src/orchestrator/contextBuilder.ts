import type { TaskRecord } from "../types.js";

// Builds the user-message text handed to each agent call. The section headers here are
// a stable, documented format both the live model and the mock provider parse -- keep
// them in sync with server/src/llm/mockProvider.ts if you change them.

export function buildPlanningContext(prompt: string): string {
  return `## User request\n${prompt}\n\nDecide which specialist agents are actually needed (listing, pricing, inventory, messages, compliance) and create a task plan with create_plan, or set direct_answer if this needs no specialist work.`;
}

export function buildFinalizeContext(
  prompt: string,
  completed: { id: string; title: string; agentRole: string; output: string }[],
  failed: { id: string; title: string; agentRole: string; feedback: string | null }[]
): string {
  const sections = completed.map((t) => `### ${t.title} (${t.agentRole}, id=${t.id})\n${t.output}`).join("\n\n");
  const failedSection = failed.length
    ? `\n\n## Unresolved / failed tasks (be honest about these in your final answer -- do not imply they succeeded)\n` +
      failed.map((t) => `- ${t.title} (${t.agentRole}, id=${t.id}): ${t.feedback ?? "failed without a specific reason recorded"}`).join("\n")
    : "";
  return `## Original user request\n${prompt}\n\n## Completed work\n${sections || "(nothing completed)"}${failedSection}\n\n## Instructions\nSynthesize one polished final response for the user with finish_run. Only state that something was tested or verified if real QA evidence (an actual command and its real output/exit code) appears above.`;
}

export function buildTaskContext(params: {
  prompt: string;
  task: TaskRecord;
  allTasks: TaskRecord[];
  dependencyOutputs: TaskRecord[];
}): string {
  const idList = params.allTasks.map((t) => `- ${t.id} (${t.agentRole}): ${t.title}`).join("\n");
  const depSection = params.dependencyOutputs.length
    ? `## Context from completed dependency tasks\n${params.dependencyOutputs
        .map((t) => `### ${t.title} (${t.agentRole}, id=${t.id})\n${t.output ?? ""}`)
        .join("\n\n")}\n\n`
    : "";
  const retrySection =
    params.task.attempt > 1 && params.task.feedback
      ? `\n\n## Retry feedback -- you previously attempted this and it was rejected. Address this specifically before finishing.\n${params.task.feedback}`
      : "";

  return `## Original user request\n${params.prompt}\n\n## Your assignment: ${params.task.title}\n${params.task.instructions}\n\n${
    idList ? `## Task IDs you may reference (for flag_issue / handoff)\n${idList}\n\n` : ""
  }${depSection}${retrySection}`.trim();
}
