import { getEbayClient } from "../ebay/index.js";
import {
  GetListingInput,
  SearchComparableInput,
  GetOrdersInput,
  GetBuyerMessagesInput,
  GetBuyerOffersInput,
  CreateListingToolInput,
  UpdateListingDetailsInput,
  UpdateListingPriceInput,
  UpdateListingQuantityInput,
  EndListingInput,
  ReplyToBuyerMessageInput,
  RespondToOfferInput,
} from "../llm/tools.js";

// Executes the side-effecting eBay tools for real (or via the clearly-labeled mock client
// -- see ebay/index.ts for how that's chosen). Control-flow tools (create_plan/finish_task/
// finish_run/handoff/flag_issue) are handled by the orchestrator itself as signals; this
// just needs to return them a well-formed tool_result acknowledgment so the conversation
// stays valid.
export async function executeEbayTool(name: string, input: unknown): Promise<string> {
  const ebay = getEbayClient();
  try {
    switch (name) {
      case "list_ebay_listings": {
        const listings = await ebay.listListings();
        return JSON.stringify({ ok: true, listings });
      }
      case "get_ebay_listing": {
        const parsed = GetListingInput.parse(input);
        const listing = await ebay.getListing(parsed.sku);
        return JSON.stringify(listing ? { ok: true, listing } : { ok: false, error: `No listing found for SKU ${parsed.sku}` });
      }
      case "search_comparable_listings": {
        const parsed = SearchComparableInput.parse(input);
        const results = await ebay.searchComparableListings(parsed.query, parsed.limit);
        return JSON.stringify({ ok: true, results });
      }
      case "get_ebay_orders": {
        const parsed = GetOrdersInput.parse(input);
        const orders = await ebay.getOrders(parsed.since_hours);
        return JSON.stringify({ ok: true, orders });
      }
      case "get_buyer_messages": {
        const parsed = GetBuyerMessagesInput.parse(input);
        const messages = await ebay.getBuyerMessages(parsed.unreplied_only);
        return JSON.stringify({ ok: true, messages });
      }
      case "create_ebay_listing": {
        const parsed = CreateListingToolInput.parse(input);
        const { listing, result } = await ebay.createListing({
          title: parsed.title,
          description: parsed.description,
          categoryId: parsed.category_id,
          price: parsed.price,
          quantity: parsed.quantity,
          sku: parsed.sku,
          floorPrice: parsed.floor_price,
        });
        return JSON.stringify({ ...result, listing });
      }
      case "update_listing_details": {
        const parsed = UpdateListingDetailsInput.parse(input);
        const result = await ebay.updateListingDetails(parsed.sku, { title: parsed.title, description: parsed.description });
        return JSON.stringify(result);
      }
      case "update_listing_price": {
        const parsed = UpdateListingPriceInput.parse(input);
        const result = await ebay.updateListingPrice(parsed.sku, parsed.price);
        return JSON.stringify(result);
      }
      case "update_listing_quantity": {
        const parsed = UpdateListingQuantityInput.parse(input);
        const result = await ebay.updateListingQuantity(parsed.sku, parsed.quantity);
        return JSON.stringify(result);
      }
      case "end_ebay_listing": {
        const parsed = EndListingInput.parse(input);
        const result = await ebay.endListing(parsed.sku, parsed.reason);
        return JSON.stringify(result);
      }
      case "reply_to_buyer_message": {
        const parsed = ReplyToBuyerMessageInput.parse(input);
        const result = await ebay.replyToBuyerMessage(parsed.message_id, parsed.body);
        return JSON.stringify(result);
      }
      case "get_buyer_offers": {
        const parsed = GetBuyerOffersInput.parse(input);
        const offers = await ebay.getBuyerOffers(parsed.pending_only);
        return JSON.stringify({ ok: true, offers });
      }
      case "respond_to_offer": {
        const parsed = RespondToOfferInput.parse(input);
        const result = await ebay.respondToOffer(parsed.offer_id, parsed.action, parsed.counter_price);
        return JSON.stringify(result);
      }
      default:
        return JSON.stringify({ ok: true, acknowledged: name });
    }
  } catch (err) {
    return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
