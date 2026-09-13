import type { ChatMessage, ContentBlock, ToolDefinition, LlmResponse } from "./client.js";

// A deterministic, clearly-labeled stand-in for the real Claude API, used automatically
// when ANTHROPIC_API_KEY is not configured. It lets the *entire* orchestration engine
// (planning, task graph execution, handoffs, real eBay tool calls against the mock eBay
// store, retry-on-real-failure, guardrails) be exercised and verified for real -- only
// the "what would the model decide" step is simulated. Tool execution itself (the eBay
// client calls) is always real against whichever eBay client is active (mock or live),
// never faked, in both LLM modes.

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

function lastToolResultJson(messages: ChatMessage[]): any {
  const results = toolResultsOf(messages[messages.length - 1]);
  try {
    return JSON.parse(results[0]?.content ?? "{}");
  } catch {
    return {};
  }
}

const LISTING_KEYWORDS = ["list a", "listing", "publish", "new item", "add a product", "sell a", "create an item", "relist"];
const PRICING_KEYWORDS = ["price", "pricing", "reprice", "discount", "cheaper", "raise the price", "lower the price", "competitor", "market rate", "undercut"];
const INVENTORY_KEYWORDS = ["inventory", "stock", "quantity", "restock", "out of stock", "sold out", "how many", "units left"];
const MESSAGES_KEYWORDS = ["message", "buyer", "question", "reply", "respond to", "customer", "inbox"];

function matchesAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  // Word-boundary matching, not a plain substring check -- a bare .includes() would let
  // e.g. "listing" false-match inside "comparable listings" (a pricing/search phrase, not
  // a listing-creation one). \b correctly does NOT match "listing" inside "listings" since
  // both the 'g' and the following 's' are word characters (no boundary between them).
  return keywords.some((k) => {
    const escaped = k.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(lower);
  });
}

// The demo scenario's SKUs, matching ebay/mockClient.ts's seed data.
const DEMO_PRICING_SKU = "MOCK-CHGR-USBC-02"; // floorPrice 12.00, currently 19.50
const DEMO_INVENTORY_SKU = "MOCK-STAND-TAB-03"; // currently active with 0 quantity

function planFor(prompt: string) {
  const needsListing = matchesAny(prompt, LISTING_KEYWORDS);
  const needsPricing = matchesAny(prompt, PRICING_KEYWORDS);
  const needsInventory = matchesAny(prompt, INVENTORY_KEYWORDS);
  const needsMessages = matchesAny(prompt, MESSAGES_KEYWORDS);

  const tasks: any[] = [];
  if (needsListing) {
    tasks.push({
      id: "listing-1",
      title: "Handle the listing request",
      agent_role: "listing",
      instructions: `Handle this listing request against the seller's eBay account: "${prompt}"`,
      depends_on: [],
    });
  }
  if (needsPricing) {
    tasks.push({
      id: "pricing-1",
      title: "Research and update pricing",
      agent_role: "pricing",
      instructions: `Handle this pricing request against the seller's eBay account: "${prompt}"`,
      depends_on: [],
    });
  }
  if (needsInventory) {
    tasks.push({
      id: "inventory-1",
      title: "Check and update inventory",
      agent_role: "inventory",
      instructions: `Handle this inventory request against the seller's eBay account: "${prompt}"`,
      depends_on: [],
    });
  }
  if (needsMessages) {
    tasks.push({
      id: "messages-1",
      title: "Handle buyer messages",
      agent_role: "messages",
      instructions: `Handle this buyer-message request against the seller's eBay account: "${prompt}"`,
      depends_on: [],
    });
  }
  if (tasks.length > 0) {
    tasks.push({
      id: "compliance-1",
      title: "Compliance review",
      agent_role: "compliance",
      instructions: `Verify all completed work against the original request: "${prompt}". Confirm every reported eBay action really happened (or was honestly reported as a dry run) before approving.`,
      depends_on: tasks.map((t) => t.id),
    });
  }
  return tasks;
}

export async function mockComplete(params: { system: string; messages: ChatMessage[]; tools: ToolDefinition[] }): Promise<LlmResponse> {
  const role = agentRole(params.system);
  const tools = params.tools;
  const turn = assistantTurnCount(params.messages);
  const context = firstUserText(params.messages);
  const isRetry = /## Retry feedback/.test(context);
  const lastResult = lastToolResultJson(params.messages);

  // ---------------------------------------------------------------- manager: planning
  if (role === "manager" && has(tools, "create_plan")) {
    const promptMatch = context.match(/## User request\n([\s\S]*?)\n\n/);
    const prompt = promptMatch ? promptMatch[1].trim() : context.trim();
    const tasks = planFor(prompt);
    if (tasks.length === 0) {
      return respond(
        "This looks like a simple question I can answer directly without spinning up the team.",
        [{ name: "create_plan", input: { tasks: [], direct_answer: `[MOCK MODE - no ANTHROPIC_API_KEY set, so this is a deterministic placeholder, not a real reasoned answer] You asked: "${prompt}". Configure ANTHROPIC_API_KEY for a real answer from the manager agent.` } }]
      );
    }
    return respond(`Breaking this down across ${tasks.map((t) => t.agent_role).join(", ")}.`, [{ name: "create_plan", input: { tasks } }]);
  }

  // ---------------------------------------------------------------- manager: finalize
  if (role === "manager" && has(tools, "finish_run")) {
    const sections = [...context.matchAll(/### (.+?)\n([\s\S]*?)(?=\n### |\n## |\n*$)/g)];
    const lines = sections.map(([, header, body]) => `**${header.trim()}**\n${body.trim()}`);
    const anyDryRun = /"dryRun":\s*true/.test(context);
    const anyRejected = /"ok":\s*false/.test(context);
    let note = "";
    if (anyDryRun) note += "\n\n_Note: at least one action above ran as a DRY RUN (EBAY_LIVE_MODE is not enabled) -- nothing was actually changed on eBay for that step._";
    if (anyRejected) note += "\n\n_Note: at least one action was rejected by eBay/the mock store (e.g. a floor-price guard); see the task history for how it was resolved._";
    const final = `## Result\n\n${lines.join("\n\n")}${note}\n\n_(MOCK MODE: no ANTHROPIC_API_KEY configured, so this summary was assembled deterministically from the real task outputs above rather than written by a real model. Set ANTHROPIC_API_KEY for real agent reasoning.)_`;
    return respond("All required work is complete and reviewed; finalizing.", [{ name: "finish_run", input: { final_result: final } }]);
  }

  // ---------------------------------------------------------------------- listing
  if (role === "listing") {
    if (turn === 0) {
      return respond("Checking existing listings before making changes.", [{ name: "list_ebay_listings", input: {} }]);
    }
    if (turn === 1) {
      const wantsNew = /create|new item|new listing|add a product|sell a/i.test(context);
      if (wantsNew) {
        return respond("Creating the new listing.", [
          {
            name: "create_ebay_listing",
            input: {
              title: "[MOCK] New Item - Listed by AI Team",
              description: "[MOCK MODE] Placeholder description -- no ANTHROPIC_API_KEY configured, so no real product details were reasoned about. Configure ANTHROPIC_API_KEY for the listing agent to write a real, accurate listing from your instructions.",
              category_id: "182097",
              price: 19.99,
              quantity: 5,
            },
          },
        ]);
      }
      const listings = lastResult.listings ?? [];
      const target = listings[0]?.sku ?? DEMO_PRICING_SKU;
      return respond("Updating the existing listing's details.", [
        { name: "update_listing_details", input: { sku: target, description: "[MOCK MODE] Description refreshed by the listing agent (placeholder -- set ANTHROPIC_API_KEY for a real rewrite)." } },
      ]);
    }
    return respond("", [
      {
        name: "finish_task",
        input: {
          summary: "Handled the listing request.",
          output: `Tool result: ${JSON.stringify(lastResult)}`,
        },
      },
    ]);
  }

  // ---------------------------------------------------------------------- pricing
  if (role === "pricing") {
    if (turn === 0) {
      return respond(`Looking up the current listing before changing anything.`, [{ name: "get_ebay_listing", input: { sku: DEMO_PRICING_SKU } }]);
    }
    if (turn === 1) {
      const title = lastResult.listing?.title ?? "the product";
      return respond("Checking comparable listings for market context.", [{ name: "search_comparable_listings", input: { query: title, limit: 5 } }]);
    }
    if (turn === 2) {
      // Attempt 1 deliberately undercuts below the floor price the mock store enforces,
      // so compliance has a real, genuine rejection to catch -- mirroring how the original
      // dev-team mock shipped a real bug on attempt 1 for QA to find for real.
      const proposedPrice = isRetry ? 13.5 : 8.99;
      return respond(
        isRetry ? "Applying a corrected price that respects the floor." : "Applying a competitive price based on comparable listings.",
        [{ name: "update_listing_price", input: { sku: DEMO_PRICING_SKU, price: proposedPrice } }]
      );
    }
    return respond("", [
      {
        name: "finish_task",
        input: {
          summary: lastResult.ok ? "Updated the price." : "Price change was rejected by eBay's floor-price guard.",
          output: `Tool result: ${JSON.stringify(lastResult)}`,
        },
      },
    ]);
  }

  // ---------------------------------------------------------------------- inventory
  if (role === "inventory") {
    if (turn === 0) {
      return respond("Reviewing current listings and stock levels.", [{ name: "list_ebay_listings", input: {} }]);
    }
    if (turn === 1) {
      return respond("Checking recent order activity for demand context.", [{ name: "get_ebay_orders", input: { since_hours: 168 } }]);
    }
    if (turn === 2) {
      const listings = (lastResult.orders ? [] : lastResult.listings) ?? [];
      const zeroStock = listings.find((l: any) => l.quantity === 0);
      const targetSku = zeroStock?.sku ?? DEMO_INVENTORY_SKU;
      return respond(`Restocking ${targetSku}, which shows zero quantity.`, [{ name: "update_listing_quantity", input: { sku: targetSku, quantity: 10 } }]);
    }
    return respond("", [
      { name: "finish_task", input: { summary: "Reviewed inventory and updated stock.", output: `Tool result: ${JSON.stringify(lastResult)}` } },
    ]);
  }

  // ---------------------------------------------------------------------- messages
  if (role === "messages") {
    if (turn === 0) {
      return respond("Checking for unanswered buyer messages.", [{ name: "get_buyer_messages", input: { unreplied_only: true } }]);
    }
    if (turn === 1) {
      const msgs = lastResult.messages ?? [];
      if (msgs.length === 0) {
        return respond("", [{ name: "finish_task", input: { summary: "No unanswered buyer messages found.", output: "get_buyer_messages returned an empty list -- nothing to reply to." } }]);
      }
      const target = msgs[0];
      return respond(`Replying to ${target.buyerUsername}'s question.`, [
        {
          name: "reply_to_buyer_message",
          input: {
            message_id: target.messageId,
            body: `[MOCK MODE] Thanks for reaching out! This is a placeholder reply -- no ANTHROPIC_API_KEY is configured, so the messages agent could not reason about your actual question ("${target.body}"). Configure ANTHROPIC_API_KEY for a real, specific answer.`,
          },
        },
      ]);
    }
    return respond("", [
      { name: "finish_task", input: { summary: "Replied to the buyer message.", output: `Tool result: ${JSON.stringify(lastResult)}` } },
    ]);
  }

  // ---------------------------------------------------------------------- compliance
  if (role === "compliance") {
    if (turn === 0) {
      return respond("Verifying the actions taken against the live listing state.", [{ name: "get_ebay_listing", input: { sku: DEMO_PRICING_SKU } }]);
    }
    // Look for a real rejected price change in the dependency context -- if pricing's own
    // reported output shows ok:false, that's a genuine defect to flag, not a stylistic one.
    const pricingRejected = /pricing-1[\s\S]*?"ok":\s*false/.test(context) || /"ok":\s*false[\s\S]*?below the floor/i.test(context);
    if (pricingRejected && !isRetry) {
      return respond("Found a real problem: the price change was rejected by the floor-price guard.", [
        {
          name: "flag_issue",
          input: {
            target_task_id: "pricing-1",
            message: "update_listing_price returned ok:false -- the proposed price was below this listing's floor price and was NOT applied. Propose a price at or above the floor and try again.",
            severity: "blocking",
          },
        },
        { name: "finish_task", input: { summary: "Flagged a real pricing defect for retry.", output: "pricing-1's price change was rejected by eBay's floor-price guard; sent back with specific feedback." } },
      ]);
    }
    return respond("", [
      { name: "finish_task", input: { summary: "Reviewed all completed work against the original request; approved.", output: `Verified via get_ebay_listing: ${JSON.stringify(lastResult)}. No further issues found.` } },
    ]);
  }

  // Fallback: should not normally be reached.
  const lastToolUses = lastAssistantToolUses(params.messages);
  if (lastToolUses.length > 0 || has(tools, "finish_task")) {
    return respond("", [{ name: "finish_task", input: { summary: "Completed (mock fallback).", output: "No specific mock behavior matched; completed with a generic result." } }]);
  }
  return respond("[MOCK MODE] No ANTHROPIC_API_KEY configured and no matching mock behavior for this step.", []);
}
