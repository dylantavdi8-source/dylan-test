import type { ChatMessage, ContentBlock, ToolDefinition, LlmResponse } from "./client.js";

// A deterministic, clearly-labeled stand-in for the real Claude API, used automatically
// when ANTHROPIC_API_KEY is not configured. It lets the *entire* orchestration engine
// (planning, task graph execution, handoffs, sandboxed file writes, real command
// execution for QA, retry-on-failure, guardrails) be exercised and verified for real --
// only the "what would the model decide" step is simulated. Tool execution itself
// (file IO, running commands) is always real, never faked, in both modes.

function textOf(msg: ChatMessage | undefined): string {
  if (!msg) return "";
  return msg.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function firstUserText(messages: ChatMessage[]): string {
  return textOf(messages.find((m) => m.role === "user"));
}

function toolResultsOf(msg: ChatMessage | undefined): { tool_use_id: string; content: string }[] {
  if (!msg) return [];
  return msg.content.filter((b): b is { type: "tool_result"; tool_use_id: string; content: string } => b.type === "tool_result");
}

function lastAssistantToolUses(messages: ChatMessage[]): { id: string; name: string; input: any }[] {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (!lastAssistant) return [];
  return lastAssistant.content.filter((b): b is { type: "tool_use"; id: string; name: string; input: any } => b.type === "tool_use");
}

function assistantTurnCount(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === "assistant").length;
}

function has(tools: ToolDefinition[], name: string): boolean {
  return tools.some((t) => t.name === name);
}

function respond(text: string, toolUses: { name: string; input: any }[]): LlmResponse {
  const content: ContentBlock[] = [];
  if (text) content.push({ type: "text", text });
  toolUses.forEach((tu, i) => content.push({ type: "tool_use", id: `mock_${Date.now()}_${i}`, name: tu.name, input: tu.input }));
  return { content, stopReason: toolUses.length > 0 ? "tool_use" : "end_turn" };
}

function agentRole(system: string): string {
  const m = system.match(/AGENT_ROLE:\s*(\w+)/);
  return m ? m[1] : "unknown";
}

const CODING_KEYWORDS = ["build", "code", "script", "program", "function", "implement", "app", "api", "bot", "algorithm", "write a", "create a tool", "develop"];
const DESIGN_KEYWORDS = ["design", "ui", "ux", "interface", "layout", "mockup", "wireframe", "landing page", "visual"];
const RESEARCH_KEYWORDS = ["research", "compare", "investigate", "find out", "summarize", "pros and cons", "learn about", "what are the best", "options for"];

function matchesAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => {
    const escaped = k.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(lower);
  });
}

function planFor(prompt: string) {
  const needsCoding = matchesAny(prompt, CODING_KEYWORDS);
  const needsDesign = matchesAny(prompt, DESIGN_KEYWORDS);
  const needsResearch = matchesAny(prompt, RESEARCH_KEYWORDS);

  const tasks: any[] = [];
  if (needsResearch) {
    tasks.push({
      id: "research-1",
      title: "Research background context",
      agent_role: "research",
      instructions: `Gather and summarize the background/context needed for this request: "${prompt}"`,
      depends_on: [],
    });
  }
  if (needsDesign) {
    tasks.push({
      id: "design-1",
      title: "Produce UI/UX design spec",
      agent_role: "design",
      instructions: `Produce a concise UI/UX design spec (and starter markup/CSS if relevant) for: "${prompt}"`,
      depends_on: needsResearch ? ["research-1"] : [],
    });
  }
  if (needsCoding) {
    tasks.push({
      id: "coding-1",
      title: "Implement the solution",
      agent_role: "coding",
      instructions: `Write working code in the shared workspace that fulfills: "${prompt}"`,
      depends_on: [...(needsResearch ? ["research-1"] : []), ...(needsDesign ? ["design-1"] : [])],
    });
    tasks.push({
      id: "testing-1",
      title: "Test the implementation",
      agent_role: "testing",
      instructions: `Actually execute the code written for coding-1 and verify it works. Flag coding-1 with a specific, actionable message if it fails.`,
      depends_on: ["coding-1"],
    });
  }
  if (tasks.length > 0) {
    tasks.push({
      id: "review-1",
      title: "Final review",
      agent_role: "review",
      instructions: `Do a final holistic review of all completed work against the original request: "${prompt}". Confirm QA evidence is real before approving.`,
      depends_on: tasks.map((t) => t.id),
    });
  }
  return tasks;
}

function mockCoding(retry: boolean): string {
  // Attempt 1 ships with a real, deliberate bug so QA has something genuine to catch;
  // the retry attempt (triggered by a real flag_issue from testing) fixes it for real.
  if (!retry) {
    return `// mock-generated (attempt 1) -- intentionally buggy so QA can genuinely catch it
function add(a, b) {
  return a - b; // BUG: should be a + b
}

const result = add(2, 3);
console.log("2 + 2 =", result);
if (result !== 5) {
  console.error("FAIL: expected 5, got " + result);
  process.exit(1);
}
console.log("PASS");
`;
  }
  return `// mock-generated (retry) -- bug fixed in response to real QA failure feedback
function add(a, b) {
  return a + b;
}

const result = add(2, 3);
console.log("2 + 2 =", result);
if (result !== 5) {
  console.error("FAIL: expected 5, got " + result);
  process.exit(1);
}
console.log("PASS");
`;
}

export async function mockComplete(params: { system: string; messages: ChatMessage[]; tools: ToolDefinition[] }): Promise<LlmResponse> {
  const role = agentRole(params.system);
  const tools = params.tools;
  const turn = assistantTurnCount(params.messages);
  const context = firstUserText(params.messages);
  const isRetry = /## Retry feedback/.test(context);
  const lastToolResults = toolResultsOf(params.messages[params.messages.length - 1]);
  const lastToolUses = lastAssistantToolUses(params.messages);

  if (role === "manager" && has(tools, "create_plan")) {
    const promptMatch = context.match(/## User request\n([\s\S]*?)\n\n/);
    const prompt = promptMatch ? promptMatch[1].trim() : context.trim();
    const tasks = planFor(prompt);
    if (tasks.length === 0) {
      return respond(
        "This looks simple enough to answer directly without spinning up the team.",
        [{ name: "create_plan", input: { tasks: [], direct_answer: `[MOCK MODE - no ANTHROPIC_API_KEY set, so this is a deterministic placeholder, not a real reasoned answer] You asked: "${prompt}". Configure ANTHROPIC_API_KEY for a real answer from the manager agent.` } }]
      );
    }
    return respond(`Breaking this down across ${tasks.map((t) => t.agent_role).join(", ")}.`, [{ name: "create_plan", input: { tasks } }]);
  }

  if (role === "manager" && has(tools, "finish_run")) {
    const sections = [...context.matchAll(/### (.+?)\n([\s\S]*?)(?=\n### |\n## |\n*$)/g)];
    const lines = sections.map(([, header, body]) => `**${header.trim()}**\n${body.trim()}`);
    const testedOk = /EXIT CODE: 0/.test(context);
    const testedFail = /EXIT CODE: [1-9]/.test(context) && !testedOk;
    let verdict = "";
    if (/testing/i.test(context)) {
      verdict = testedOk
        ? "\n\n_QA actually executed the code and it passed (see exit code evidence above)._"
        : testedFail
        ? "\n\n_Note: QA execution evidence shows a non-zero exit code was observed at some point; see task history for how it was resolved._"
        : "";
    }
    const final = `## Result\n\n${lines.join("\n\n")}${verdict}\n\n_(MOCK MODE: no ANTHROPIC_API_KEY configured, so this summary was assembled deterministically from the real task outputs above rather than written by a real model. Set ANTHROPIC_API_KEY for real agent reasoning.)_`;
    return respond("All required work is complete and reviewed; finalizing.", [{ name: "finish_run", input: { final_result: final } }]);
  }

  if (role === "research") {
    const assignment = context.match(/## Your assignment: (.+)/)?.[1] ?? "the research task";
    return respond("", [
      {
        name: "finish_task",
        input: {
          summary: "Synthesized background context for the team.",
          output: `[MOCK research findings for "${assignment}"] No live web access was used (no ANTHROPIC_API_KEY / search provider configured for this run). Key considerations noted for downstream agents: scope the implementation narrowly, favor a dependency-free approach so it can be tested with plain \`node\`, and keep the surface area small.`,
        },
      },
    ]);
  }

  if (role === "design") {
    if (turn === 0) {
      return respond("Writing the design spec to the workspace.", [
        { name: "write_file", input: { path: "design/spec.md", content: "# Design Spec (mock)\n\n- Minimal, single-purpose interface\n- Clear primary action\n- Real-time status feedback\n" } },
      ]);
    }
    return respond("", [{ name: "finish_task", input: { summary: "Wrote UI/UX spec.", output: "design/spec.md written to the workspace with a minimal interface spec." } }]);
  }

  if (role === "coding") {
    if (turn === 0) {
      return respond("Implementing and writing app.js to the workspace.", [
        { name: "write_file", input: { path: "app.js", content: mockCoding(isRetry) } },
      ]);
    }
    return respond("", [
      {
        name: "finish_task",
        input: {
          summary: isRetry ? "Fixed the bug flagged by QA and rewrote app.js." : "Implemented app.js.",
          output: `app.js written to the workspace${isRetry ? " (corrected after QA flagged a real failure)" : ""}.`,
        },
      },
    ]);
  }

  if (role === "testing") {
    if (turn === 0) {
      return respond("Listing workspace files before running anything.", [{ name: "list_files", input: {} }]);
    }
    if (turn === 1) {
      let target = "app.js";
      try {
        const files = JSON.parse(lastToolResults[0]?.content ?? "[]") as { path: string }[];
        const jsFile = files.find((f) => f.path.endsWith(".js"));
        if (jsFile) target = jsFile.path;
      } catch {
        /* fall back to default */
      }
      return respond(`Executing ${target} for real to verify it works.`, [{ name: "run_command", input: { command: "node", args: [target] } }]);
    }
    // turn 2: react to the real run_command result
    const result = lastToolResults[0]?.content ?? "";
    let exitCode = 0;
    try {
      exitCode = JSON.parse(result).exitCode ?? 0;
    } catch {
      exitCode = /exit code: 0/i.test(result) ? 0 : 1;
    }
    const targetIdMatch = context.match(/- (coding-\S+) \(coding\)/);
    const targetId = targetIdMatch ? targetIdMatch[1] : "coding-1";
    if (exitCode !== 0) {
      return respond("Real execution failed -- flagging the coding task with the actual error.", [
        { name: "flag_issue", input: { target_task_id: targetId, message: `Running the code failed for real with a non-zero exit code. Raw output:\n${result}`, severity: "blocking" } },
        { name: "finish_task", input: { summary: "Execution failed; flagged coding task for retry.", output: `EXIT CODE: ${exitCode}\n${result}` } },
      ]);
    }
    return respond("Execution passed for real; marking QA complete.", [
      { name: "finish_task", input: { summary: "Ran the code for real; it passed.", output: `EXIT CODE: ${exitCode}\n${result}` } },
    ]);
  }

  if (role === "review") {
    if (turn === 0) {
      return respond("Reading the produced artifacts before signing off.", [{ name: "list_files", input: {} }]);
    }
    return respond("", [
      { name: "finish_task", input: { summary: "Reviewed all completed work against the original request; approved.", output: "Reviewed task outputs and QA evidence; no further issues found." } },
    ]);
  }

  // Fallback: should not normally be reached.
  if (lastToolUses.length > 0 || has(tools, "finish_task")) {
    return respond("", [{ name: "finish_task", input: { summary: "Completed (mock fallback).", output: "No specific mock behavior matched; completed with a generic result." } }]);
  }
  return respond("[MOCK MODE] No ANTHROPIC_API_KEY configured and no matching mock behavior for this step.", []);
}
