import type { TaskRecord } from "../types.js";

// Builds the user-message text handed to each agent call. The section headers here are
// a stable, documented format both the live model and the mock provider parse -- keep
// them in sync with server/src/llm/mockProvider.ts if you change them.

function sellSpeedNote(sellSpeed: number): string {
  if (sellSpeed === 50) return "";
  const diff = sellSpeed - 50;
  const direction = diff > 0 ? "below" : "above";
  return `\n\n## Sell speed: ${sellSpeed}/100\n50 is normal (price at the comparable-listings median). This is set ${Math.abs(diff)} point(s) ${diff > 0 ? "faster" : "slower"} than normal, meaning pricing should target roughly ${(Math.abs(diff) * 0.6).toFixed(1)}% ${direction} the comps median (never below the listing's floor price) to sell ${diff > 0 ? "faster" : "more for maximum profit, accepting a slower sale"}.`;
}

export function buildPlanningContext(prompt: string, hasImage?: boolean, sellSpeed = 50): string {
  const imageNote = hasImage
    ? "\n\nA photo of the item was attached by the user. Look at it and use what you see (what the item is, its condition, distinguishing features) to fill in listing details -- title, description, category, and a reasonable starting price -- instead of asking the user to describe the item."
    : "";
  return `## User request\n${prompt}${imageNote}${sellSpeedNote(sellSpeed)}\n\nDecide which specialist agents are actually needed (listing, pricing, inventory, messages, compliance) and create a task plan with create_plan, or set direct_answer if this needs no specialist work. If a new listing is being created, include a pricing task (depending on the listing task) to set a data-driven starting price from comparable listings rather than leaving it to a guess.`;
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
  sellSpeed?: number;
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
  const speedSection = params.task.agentRole === "pricing" ? sellSpeedNote(params.sellSpeed ?? 50) : "";

  return `## Original user request\n${params.prompt}\n\n## Your assignment: ${params.task.title}\n${params.task.instructions}${speedSection}\n\n${
    idList ? `## Task IDs you may reference (for flag_issue / handoff)\n${idList}\n\n` : ""
  }${depSection}${retrySection}`.trim();
}
