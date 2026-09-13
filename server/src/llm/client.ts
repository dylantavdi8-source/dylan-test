import Anthropic from "@anthropic-ai/sdk";
import { mockComplete } from "./mockProvider.js";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: any }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface ChatMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

export interface LlmResponse {
  content: ContentBlock[];
  stopReason: string | null;
}

export interface LlmProvider {
  readonly mode: "live" | "mock";
  send(params: { system: string; messages: ChatMessage[]; tools: ToolDefinition[]; maxTokens?: number }): Promise<LlmResponse>;
}

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929";

class LiveAnthropicProvider implements LlmProvider {
  readonly mode = "live" as const;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async send(params: { system: string; messages: ChatMessage[]; tools: ToolDefinition[]; maxTokens?: number }): Promise<LlmResponse> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: params.maxTokens ?? 4096,
      system: params.system,
      // Structurally compatible with the SDK's expected message/content shapes.
      messages: params.messages as unknown as Anthropic.MessageParam[],
      tools: params.tools as unknown as Anthropic.Tool[],
    });

    const content: ContentBlock[] = response.content.map((block): ContentBlock => {
      if (block.type === "text") return { type: "text", text: block.text };
      if (block.type === "tool_use") return { type: "tool_use", id: block.id, name: block.name, input: block.input };
      return { type: "text", text: "" };
    });

    return { content, stopReason: response.stop_reason };
  }
}

class MockProvider implements LlmProvider {
  readonly mode = "mock" as const;

  async send(params: { system: string; messages: ChatMessage[]; tools: ToolDefinition[]; maxTokens?: number }): Promise<LlmResponse> {
    return mockComplete(params);
  }
}

let cachedProvider: LlmProvider | null = null;

export function getLlmProvider(): LlmProvider {
  if (cachedProvider) return cachedProvider;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  cachedProvider = apiKey ? new LiveAnthropicProvider(apiKey) : new MockProvider();
  return cachedProvider;
}
