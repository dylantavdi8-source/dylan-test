import type { AgentRole } from "../types.js";
import type { AgentDefinition } from "./base.js";
import { SHARED_RULES } from "./base.js";
import { managerAgent } from "./manager.js";
import { listingAgent } from "./listing.js";
import { pricingAgent } from "./pricing.js";
import { inventoryAgent } from "./inventory.js";
import { messagesAgent } from "./messages.js";
import { complianceAgent } from "./compliance.js";

// Central registry. To add a new specialist agent: create agents/<name>.ts exporting an
// AgentDefinition, add it here, add its tool permissions in llm/tools.ts, and teach the
// manager's planning prompt (and mock heuristic, for offline testing) when to use it --
// nothing else in the orchestrator needs to change.
export const AGENTS: Record<AgentRole, AgentDefinition> = {
  manager: managerAgent,
  listing: listingAgent,
  pricing: pricingAgent,
  inventory: inventoryAgent,
  messages: messagesAgent,
  compliance: complianceAgent,
};

export function buildSystemPrompt(role: AgentRole): string {
  const def = AGENTS[role];
  return `AGENT_ROLE: ${role}\nYou are the ${def.displayName} agent.\n\n${def.persona}\n\n---\n${SHARED_RULES}`;
}

export function agentDef(role: AgentRole): AgentDefinition {
  return AGENTS[role];
}
