// Loop / runaway-cost prevention for a single run. Three independent hard caps: total
// model calls, wall-clock time, and total tasks ever created (handoffs create new tasks,
// so this is what actually bounds a handoff ping-pong or a plan that keeps growing).
// Per-task retry limits live on the task record itself (maxAttempts).

export interface GuardrailLimits {
  maxLlmCalls: number;
  maxWallClockMs: number;
  maxTasksPerRun: number;
}

export const DEFAULT_LIMITS: GuardrailLimits = {
  maxLlmCalls: 80,
  maxWallClockMs: 10 * 60 * 1000,
  maxTasksPerRun: 30,
};

export type GuardrailCheck = { ok: true } | { ok: false; reason: string };

export class RunGuardrails {
  private llmCalls = 0;
  private taskCount = 0;
  private readonly deadline: number;
  private readonly limits: GuardrailLimits;

  constructor(limits: GuardrailLimits = DEFAULT_LIMITS) {
    this.limits = limits;
    this.deadline = Date.now() + limits.maxWallClockMs;
  }

  checkBeforeLlmCall(): GuardrailCheck {
    if (this.llmCalls >= this.limits.maxLlmCalls) {
      return { ok: false, reason: `Run exceeded the max model-call budget for this run (${this.limits.maxLlmCalls}).` };
    }
    if (Date.now() > this.deadline) {
      return { ok: false, reason: "Run exceeded its max wall-clock time budget." };
    }
    this.llmCalls++;
    return { ok: true };
  }

  checkBeforeTaskCreate(): GuardrailCheck {
    if (this.taskCount >= this.limits.maxTasksPerRun) {
      return { ok: false, reason: `Run exceeded the max task budget (${this.limits.maxTasksPerRun}) -- likely a handoff loop.` };
    }
    this.taskCount++;
    return { ok: true };
  }

  status(): GuardrailCheck {
    if (Date.now() > this.deadline) return { ok: false, reason: "Run exceeded its max wall-clock time budget." };
    if (this.llmCalls >= this.limits.maxLlmCalls) return { ok: false, reason: `Run exceeded the max model-call budget for this run (${this.limits.maxLlmCalls}).` };
    return { ok: true };
  }
}
