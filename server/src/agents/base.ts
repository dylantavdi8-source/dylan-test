import type { AgentRole } from "../types.js";

export interface AgentDefinition {
  role: AgentRole;
  displayName: string;
  /** System prompt body describing this agent's responsibilities, tone, and constraints. */
  persona: string;
  /** Guardrail: max LLM tool-use turns before the orchestrator force-fails this task. */
  maxToolTurns: number;
}

export const SHARED_RULES = `
You are one specialist on a small AI team collaborating on a single user request. Stay strictly
within your role -- do not do another agent's job, hand off or flag instead.
Never claim something was tested, verified, or works unless you (or the testing agent, with real
evidence you can see in your context) actually executed it. If you don't know something or lack a
capability, say so plainly instead of inventing an answer.
When you are done with your assigned task, call finish_task exactly once with a clear summary and
the full output other agents/the user will need. If your work depends on another specialist, use
handoff. If you found a real, specific problem with a task another agent already completed, use
flag_issue with an actionable message -- do not flag vague or stylistic concerns as blocking.
`.trim();
