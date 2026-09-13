import { getLlmProvider } from "../llm/client.js";
import type { ChatMessage, ContentBlock, ToolDefinition } from "../llm/client.js";
import type { RunGuardrails } from "./guardrails.js";

export interface ToolUseCall {
  name: string;
  input: any;
}

export interface ToolLoopResult {
  turns: number;
  allToolUses: ToolUseCall[];
  terminal: ToolUseCall | null;
  transcript: ChatMessage[];
  stoppedReason: "terminal" | "max_turns" | "guardrail" | "no_tool_call_retries_exhausted";
}

export interface ToolLoopParams {
  system: string;
  initialUserText: string;
  tools: ToolDefinition[];
  maxTurns: number;
  terminalToolNames: string[];
  guardrails: RunGuardrails;
  executeTool: (name: string, input: any) => Promise<string>;
  onToolUse?: (call: ToolUseCall) => void;
  onText?: (text: string) => void;
}

/**
 * The shared low-level primitive: drive one Claude tool-use conversation until one of
 * `terminalToolNames` is called, the turn budget runs out, or a run-wide guardrail trips.
 * Used for the manager's planning call, its finalize call, and every per-task agent run --
 * the only difference between those is which tools/terminal names are passed in.
 */
export async function runToolLoop(params: ToolLoopParams): Promise<ToolLoopResult> {
  const llm = getLlmProvider();
  const messages: ChatMessage[] = [{ role: "user", content: [{ type: "text", text: params.initialUserText }] }];
  const allToolUses: ToolUseCall[] = [];
  let terminal: ToolUseCall | null = null;
  let turns = 0;
  let emptyTurnRetries = 0;

  while (turns < params.maxTurns) {
    const guardCheck = params.guardrails.checkBeforeLlmCall();
    if (!guardCheck.ok) {
      return { turns, allToolUses, terminal: null, transcript: messages, stoppedReason: "guardrail" };
    }

    const res = await llm.send({ system: params.system, messages, tools: params.tools });
    messages.push({ role: "assistant", content: res.content });
    turns++;

    for (const block of res.content) {
      if (block.type === "text" && block.text && params.onText) params.onText(block.text);
    }

    const toolUseBlocks = res.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      emptyTurnRetries++;
      if (emptyTurnRetries >= 2) {
        return { turns, allToolUses, terminal: null, transcript: messages, stoppedReason: "no_tool_call_retries_exhausted" };
      }
      messages.push({
        role: "user",
        content: [{ type: "text", text: "You must call one of your available tools to make progress (plain text replies aren't recorded)." }],
      });
      continue;
    }

    const toolResults: ContentBlock[] = [];
    for (const tu of toolUseBlocks) {
      const call: ToolUseCall = { name: tu.name, input: tu.input };
      allToolUses.push(call);
      params.onToolUse?.(call);
      const resultStr = await params.executeTool(tu.name, tu.input);
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: resultStr });
      if (params.terminalToolNames.includes(tu.name) && !terminal) {
        terminal = call;
      }
    }
    messages.push({ role: "user", content: toolResults });

    if (terminal) {
      return { turns, allToolUses, terminal, transcript: messages, stoppedReason: "terminal" };
    }
  }

  return { turns, allToolUses, terminal: null, transcript: messages, stoppedReason: "max_turns" };
}
