import { z } from "zod";
import type { ToolDefinition } from "./client.js";
import type { AgentRole } from "../types.js";

// Every tool an agent might be granted, as an Anthropic tool JSON-schema definition
// plus a matching zod schema used to validate/parse the model's tool_use input at
// runtime (models occasionally emit malformed input; we never trust it blindly).

const AGENT_ROLE_ENUM = ["listing", "pricing", "inventory", "messages", "compliance"] as const;

export const TOOL_SCHEMAS: Record<string, ToolDefinition> = {
  create_plan: {
    name: "create_plan",
    description:
      "Break the user's request into a task graph assigned to specialist agents. Only include agents that are actually needed " +
      "for this request -- do not add a compliance task the request doesn't call for. If the request is trivial enough to " +
      "answer directly with no specialist work (e.g. a simple factual question you already have the answer to), leave tasks " +
      "empty and set direct_answer instead.",
    input_schema: {
      type: "object",
      properties: {
        direct_answer: {
          type: "string",
          description: "A complete answer to give the user immediately, only used when tasks is empty.",
        },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Short unique slug, e.g. 'pricing-1'" },
              title: { type: "string" },
              agent_role: { type: "string", enum: [...AGENT_ROLE_ENUM] },
              instructions: { type: "string", description: "Precise instructions for the assigned agent." },
              depends_on: {
                type: "array",
                items: { type: "string" },
                description: "IDs of tasks that must complete before this one can start.",
              },
            },
            required: ["id", "title", "agent_role", "instructions", "depends_on"],
          },
        },
      },
      required: ["tasks"],
    },
  },

  // --- eBay read tools -------------------------------------------------------------

  list_ebay_listings: {
    name: "list_ebay_listings",
    description: "List all current listings in the seller's eBay account (SKU, title, price, quantity, status, floor price if set).",
    input_schema: { type: "object", properties: {} },
  },

  get_ebay_listing: {
    name: "get_ebay_listing",
    description: "Get full detail for one listing by SKU.",
    input_schema: {
      type: "object",
      properties: { sku: { type: "string" } },
      required: ["sku"],
    },
  },

  search_comparable_listings: {
    name: "search_comparable_listings",
    description: "Search active eBay listings for comparable products, to get real market/competitor pricing context.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms describing the product, e.g. '65W USB-C GaN charger'." },
        limit: { type: "number", description: "Max results, default 5." },
      },
      required: ["query"],
    },
  },

  get_ebay_orders: {
    name: "get_ebay_orders",
    description: "Get recent orders (for inventory/demand context).",
    input_schema: {
      type: "object",
      properties: { since_hours: { type: "number", description: "How far back to look, default 168 (7 days)." } },
    },
  },

  get_buyer_messages: {
    name: "get_buyer_messages",
    description: "Get buyer questions/messages sent to the seller.",
    input_schema: {
      type: "object",
      properties: { unreplied_only: { type: "boolean", description: "Default true -- only messages not yet replied to." } },
    },
  },

  get_buyer_offers: {
    name: "get_buyer_offers",
    description: "Get Best Offers buyers have sent against listings (price negotiation), separate from regular messages.",
    input_schema: {
      type: "object",
      properties: { pending_only: { type: "boolean", description: "Default true -- only offers not yet responded to." } },
    },
  },

  // --- eBay write tools --------------------------------------------------------------
  // Every one of these may run as a real action or a dry-run simulation depending on
  // EBAY_LIVE_MODE -- the tool result always says which (ok/dryRun fields); report the
  // real result, never assume it went live.

  create_ebay_listing: {
    name: "create_ebay_listing",
    description: "Create and publish a new eBay listing.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        category_id: { type: "string", description: "eBay category ID." },
        price: { type: "number" },
        quantity: { type: "number" },
        sku: { type: "string", description: "Optional -- a SKU will be generated if omitted." },
        floor_price: { type: "number", description: "Optional minimum price this listing should never go below." },
      },
      required: ["title", "description", "category_id", "price", "quantity"],
    },
  },

  update_listing_details: {
    name: "update_listing_details",
    description: "Update a listing's title and/or description.",
    input_schema: {
      type: "object",
      properties: {
        sku: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["sku"],
    },
  },

  update_listing_price: {
    name: "update_listing_price",
    description:
      "Change a listing's price. May be rejected (ok:false) if it violates a floor price the seller has set -- that means the " +
      "price was NOT changed; check the result before reporting success.",
    input_schema: {
      type: "object",
      properties: { sku: { type: "string" }, price: { type: "number" } },
      required: ["sku", "price"],
    },
  },

  update_listing_quantity: {
    name: "update_listing_quantity",
    description: "Change a listing's available quantity.",
    input_schema: {
      type: "object",
      properties: { sku: { type: "string" }, quantity: { type: "number" } },
      required: ["sku", "quantity"],
    },
  },

  end_ebay_listing: {
    name: "end_ebay_listing",
    description: "End (withdraw) an active listing.",
    input_schema: {
      type: "object",
      properties: { sku: { type: "string" }, reason: { type: "string" } },
      required: ["sku", "reason"],
    },
  },

  reply_to_buyer_message: {
    name: "reply_to_buyer_message",
    description: "Send a reply to a buyer's message/question.",
    input_schema: {
      type: "object",
      properties: { message_id: { type: "string" }, body: { type: "string" } },
      required: ["message_id", "body"],
    },
  },

  respond_to_offer: {
    name: "respond_to_offer",
    description:
      "Accept, decline, or counter a buyer's Best Offer. Accepting will actually change the listing's price to the offer price. " +
      "A counter may be rejected (ok:false) if it's below the listing's floor price.",
    input_schema: {
      type: "object",
      properties: {
        offer_id: { type: "string" },
        action: { type: "string", enum: ["accept", "decline", "counter"] },
        counter_price: { type: "number", description: "Required when action is 'counter'." },
      },
      required: ["offer_id", "action"],
    },
  },

  // --- generic control-flow tools (unchanged across any agent roster) ----------------

  handoff: {
    name: "handoff",
    description:
      "Hand this task's work off to another specialist agent as a new follow-up task (e.g. listing hands off to pricing once a " +
      "new item needs its initial price researched). The target agent will receive your message plus everything produced so far.",
    input_schema: {
      type: "object",
      properties: {
        to_agent: { type: "string", enum: [...AGENT_ROLE_ENUM] },
        message: { type: "string", description: "What you want the next agent to do, and any context they need." },
      },
      required: ["to_agent", "message"],
    },
  },

  flag_issue: {
    name: "flag_issue",
    description:
      "Reject/challenge another task's output because it has a problem. This sends that task back for a retry with your " +
      "feedback attached. Use this when compliance review (or your own work) reveals a real defect -- be specific about what is wrong.",
    input_schema: {
      type: "object",
      properties: {
        target_task_id: { type: "string", description: "The id of the task whose output is defective." },
        message: { type: "string", description: "Specific, actionable description of what is wrong." },
        severity: { type: "string", enum: ["minor", "blocking"] },
      },
      required: ["target_task_id", "message", "severity"],
    },
  },

  finish_task: {
    name: "finish_task",
    description: "Mark your current task complete and record its final output for downstream agents / the final result.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One or two sentence summary of what you did." },
        output: { type: "string", description: "The full output/result of this task (real tool results, findings, verdict, etc.)." },
      },
      required: ["summary", "output"],
    },
  },

  finish_run: {
    name: "finish_run",
    description:
      "Only call this once all necessary work is complete and (if any eBay action was taken) has been reviewed by compliance. " +
      "Produces the final polished response returned to the user.",
    input_schema: {
      type: "object",
      properties: {
        final_result: { type: "string", description: "Polished, complete final answer for the user in markdown." },
      },
      required: ["final_result"],
    },
  },
};

export const TOOLS_BY_ROLE: Record<AgentRole, string[]> = {
  manager: ["create_plan", "list_ebay_listings", "get_ebay_listing", "flag_issue", "finish_run"],
  listing: [
    "list_ebay_listings",
    "get_ebay_listing",
    "create_ebay_listing",
    "update_listing_details",
    "end_ebay_listing",
    "handoff",
    "finish_task",
  ],
  pricing: ["get_ebay_listing", "list_ebay_listings", "search_comparable_listings", "update_listing_price", "handoff", "finish_task"],
  inventory: ["list_ebay_listings", "get_ebay_listing", "get_ebay_orders", "update_listing_quantity", "handoff", "finish_task"],
  messages: [
    "get_buyer_messages",
    "get_buyer_offers",
    "get_ebay_listing",
    "reply_to_buyer_message",
    "respond_to_offer",
    "handoff",
    "finish_task",
  ],
  compliance: ["get_ebay_listing", "list_ebay_listings", "get_ebay_orders", "flag_issue", "handoff", "finish_task"],
};

export function toolsForRole(role: AgentRole): ToolDefinition[] {
  return TOOLS_BY_ROLE[role].map((name) => TOOL_SCHEMAS[name]);
}

// --- zod validators for runtime-safe parsing of tool_use input ---

export const PlanTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  agent_role: z.enum(AGENT_ROLE_ENUM),
  instructions: z.string().min(1),
  depends_on: z.array(z.string()).default([]),
});

export const CreatePlanInput = z.object({
  direct_answer: z.string().optional(),
  tasks: z.array(PlanTaskSchema).default([]),
});

export const HandoffInput = z.object({
  to_agent: z.enum(AGENT_ROLE_ENUM),
  message: z.string().min(1),
});
export const FlagIssueInput = z.object({
  target_task_id: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["minor", "blocking"]),
});
export const FinishTaskInput = z.object({ summary: z.string().min(1), output: z.string() });
export const FinishRunInput = z.object({ final_result: z.string().min(1) });

export const GetListingInput = z.object({ sku: z.string().min(1) });
export const SearchComparableInput = z.object({ query: z.string().min(1), limit: z.number().int().positive().max(20).optional() });
export const GetOrdersInput = z.object({ since_hours: z.number().positive().optional() });
export const GetBuyerMessagesInput = z.object({ unreplied_only: z.boolean().optional() });
export const GetBuyerOffersInput = z.object({ pending_only: z.boolean().optional() });
export const RespondToOfferInput = z.object({
  offer_id: z.string().min(1),
  action: z.enum(["accept", "decline", "counter"]),
  counter_price: z.number().positive().optional(),
});
export const CreateListingToolInput = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  category_id: z.string().min(1),
  price: z.number().positive(),
  quantity: z.number().int().nonnegative(),
  sku: z.string().min(1).optional(),
  floor_price: z.number().positive().optional(),
});
export const UpdateListingDetailsInput = z.object({
  sku: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});
export const UpdateListingPriceInput = z.object({ sku: z.string().min(1), price: z.number().positive() });
export const UpdateListingQuantityInput = z.object({ sku: z.string().min(1), quantity: z.number().int().nonnegative() });
export const EndListingInput = z.object({ sku: z.string().min(1), reason: z.string().min(1) });
export const ReplyToBuyerMessageInput = z.object({ message_id: z.string().min(1), body: z.string().min(1) });
