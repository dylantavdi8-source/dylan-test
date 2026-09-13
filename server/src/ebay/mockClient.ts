import type {
  EbayClient,
  EbayListing,
  CreateListingInput,
  CompetitorListing,
  EbayOrder,
  BuyerMessage,
  ActionResult,
} from "./types.js";

// A deterministic, clearly-labeled stand-in for real eBay API calls, used automatically
// when eBay credentials (EBAY_CLIENT_ID / EBAY_REFRESH_TOKEN) are not configured. Seeded
// with a small, realistic in-memory store so the Listing/Pricing/Inventory/Messages/
// Compliance agents can be exercised end-to-end against *something* real-shaped, with one
// deliberate floor-price violation so Compliance has a genuine defect to catch (mirroring
// how the original mock LLM provider seeds a real bug for QA to find).

function seedListings(): EbayListing[] {
  const now = Date.now();
  return [
    {
      sku: "MOCK-CASE-BLK-01",
      offerId: "off-1001",
      listingId: "lst-1001",
      title: "Slim Leather Phone Case - Black - Fits iPhone 14/15",
      description: "Genuine leather, slim profile, precise cutouts. New in box.",
      categoryId: "20349",
      price: 24.99,
      currency: "USD",
      quantity: 18,
      quantitySold: 42,
      status: "active",
      floorPrice: 14.0,
      marketplaceId: "EBAY_US",
      updatedAt: now - 86_400_000,
    },
    {
      sku: "MOCK-CHGR-USBC-02",
      offerId: "off-1002",
      listingId: "lst-1002",
      title: "65W USB-C Fast Charger Block - GaN - White",
      description: "Compact GaN charger, fast charges phones and laptops.",
      categoryId: "182106",
      price: 19.5,
      currency: "USD",
      quantity: 3,
      quantitySold: 97,
      status: "active",
      floorPrice: 12.0,
      marketplaceId: "EBAY_US",
      updatedAt: now - 3_600_000,
    },
    {
      sku: "MOCK-STAND-TAB-03",
      offerId: "off-1003",
      listingId: "lst-1003",
      title: "Adjustable Aluminum Tablet Stand - Foldable",
      description: "Sturdy aluminum stand, adjustable angle, folds flat for travel.",
      categoryId: "182097",
      price: 15.75,
      currency: "USD",
      quantity: 0,
      quantitySold: 61,
      status: "active",
      floorPrice: 9.0,
      marketplaceId: "EBAY_US",
      updatedAt: now - 7_200_000,
    },
  ];
}

function seedOrders(): EbayOrder[] {
  const now = Date.now();
  return [
    { orderId: "ord-5001", sku: "MOCK-CHGR-USBC-02", title: "65W USB-C Fast Charger Block - GaN - White", quantity: 2, price: 19.5, buyerUsername: "buyer_jt88", status: "pending", createdAt: now - 5_400_000 },
    { orderId: "ord-5002", sku: "MOCK-CASE-BLK-01", title: "Slim Leather Phone Case - Black - Fits iPhone 14/15", quantity: 1, price: 24.99, buyerUsername: "quickdeals_22", status: "shipped", createdAt: now - 172_800_000 },
  ];
}

function seedMessages(): BuyerMessage[] {
  const now = Date.now();
  return [
    {
      messageId: "msg-9001",
      sku: "MOCK-STAND-TAB-03",
      listingTitle: "Adjustable Aluminum Tablet Stand - Foldable",
      buyerUsername: "reader_amy",
      subject: "Restock?",
      body: "Hi! This shows 0 quantity -- do you know when it'll be back in stock? Want to grab two.",
      receivedAt: now - 10_800_000,
      replied: false,
    },
    {
      messageId: "msg-9002",
      sku: "MOCK-CASE-BLK-01",
      listingTitle: "Slim Leather Phone Case - Black - Fits iPhone 14/15",
      buyerUsername: "casey_c",
      subject: "Does this fit iPhone 15 Pro Max?",
      body: "Item title says 14/15 -- does that include the Pro Max size specifically?",
      receivedAt: now - 3_600_000,
      replied: false,
    },
  ];
}

let listings = seedListings();
const orders = seedOrders();
let messages = seedMessages();
let nextSkuNum = 100;

function log(action: string, detail: string) {
  // eslint-disable-next-line no-console
  console.log(`[MOCK EBAY] ${action}: ${detail}`);
}

export function createMockEbayClient(): EbayClient {
  return {
    mode: "mock",
    liveActionsEnabled: false, // the mock store is always "live" to itself, but it's never real eBay

    async listListings() {
      return listings;
    },

    async getListing(sku: string) {
      return listings.find((l) => l.sku === sku) ?? null;
    },

    async createListing(input: CreateListingInput) {
      const sku = input.sku ?? `MOCK-NEW-${nextSkuNum++}`;
      const listing: EbayListing = {
        sku,
        offerId: `off-${2000 + listings.length}`,
        listingId: `lst-${2000 + listings.length}`,
        title: input.title,
        description: input.description,
        categoryId: input.categoryId,
        price: input.price,
        currency: "USD",
        quantity: input.quantity,
        quantitySold: 0,
        status: "active",
        floorPrice: input.floorPrice ?? null,
        marketplaceId: "EBAY_US",
        updatedAt: Date.now(),
      };
      listings.push(listing);
      log("createListing", `${sku} "${input.title}" @ $${input.price}`);
      return {
        listing,
        result: { ok: true, dryRun: false, detail: `[MOCK] Created and published listing ${sku}.` },
      };
    },

    async updateListingDetails(sku, patch) {
      const l = listings.find((x) => x.sku === sku);
      if (!l) return { ok: false, dryRun: false, detail: `[MOCK] No such SKU: ${sku}` };
      if (patch.title) l.title = patch.title;
      if (patch.description) l.description = patch.description;
      l.updatedAt = Date.now();
      log("updateListingDetails", sku);
      return { ok: true, dryRun: false, detail: `[MOCK] Updated details for ${sku}.` };
    },

    async updateListingPrice(sku, price) {
      const l = listings.find((x) => x.sku === sku);
      if (!l) return { ok: false, dryRun: false, detail: `[MOCK] No such SKU: ${sku}` };
      // Deliberate real guardrail: the mock store itself refuses a below-floor price, so
      // Compliance has a genuine defect to catch and Pricing gets genuine feedback to act on.
      if (l.floorPrice !== null && price < l.floorPrice) {
        log("updateListingPrice", `REJECTED ${sku}: $${price} is below floor $${l.floorPrice}`);
        return {
          ok: false,
          dryRun: false,
          detail: `[MOCK] Rejected: $${price.toFixed(2)} is below the floor price of $${l.floorPrice.toFixed(2)} for ${sku}. Price was NOT changed (still $${l.price.toFixed(2)}).`,
        };
      }
      const old = l.price;
      l.price = price;
      l.updatedAt = Date.now();
      log("updateListingPrice", `${sku}: $${old} -> $${price}`);
      return { ok: true, dryRun: false, detail: `[MOCK] Updated ${sku} price: $${old.toFixed(2)} -> $${price.toFixed(2)}.` };
    },

    async updateListingQuantity(sku, quantity) {
      const l = listings.find((x) => x.sku === sku);
      if (!l) return { ok: false, dryRun: false, detail: `[MOCK] No such SKU: ${sku}` };
      const old = l.quantity;
      l.quantity = quantity;
      l.updatedAt = Date.now();
      log("updateListingQuantity", `${sku}: ${old} -> ${quantity}`);
      return { ok: true, dryRun: false, detail: `[MOCK] Updated ${sku} quantity: ${old} -> ${quantity}.` };
    },

    async endListing(sku, reason) {
      const l = listings.find((x) => x.sku === sku);
      if (!l) return { ok: false, dryRun: false, detail: `[MOCK] No such SKU: ${sku}` };
      l.status = "ended";
      l.updatedAt = Date.now();
      log("endListing", `${sku}: ${reason}`);
      return { ok: true, dryRun: false, detail: `[MOCK] Ended listing ${sku} (${reason}).` };
    },

    async searchComparableListings(query: string, limit = 5) {
      // Deterministic fake competitor data derived from the query so results feel grounded.
      const base = 10 + (query.length % 15);
      const results: CompetitorListing[] = Array.from({ length: Math.min(limit, 5) }).map((_, i) => ({
        title: `${query} - ${["New", "Used - Like New", "New", "New", "Used - Good"][i % 5]} (comparable listing ${i + 1})`,
        price: Number((base + i * 2.35 + (i % 2 === 0 ? 1.5 : 0)).toFixed(2)),
        currency: "USD",
        condition: i % 5 === 1 || i % 5 === 4 ? "Used" : "New",
        itemWebUrl: `https://www.ebay.com/itm/mock-${Math.abs(hash(query)) % 100000 + i}`,
        seller: `mock_seller_${(i % 3) + 1}`,
      }));
      log("searchComparableListings", `"${query}" -> ${results.length} results`);
      return results;
    },

    async getOrders(sinceHours = 24 * 7) {
      const cutoff = Date.now() - sinceHours * 3_600_000;
      return orders.filter((o) => o.createdAt >= cutoff);
    },

    async getBuyerMessages(unrepliedOnly = true) {
      return unrepliedOnly ? messages.filter((m) => !m.replied) : messages;
    },

    async replyToBuyerMessage(messageId: string, body: string): Promise<ActionResult> {
      const m = messages.find((x) => x.messageId === messageId);
      if (!m) return { ok: false, dryRun: false, detail: `[MOCK] No such message: ${messageId}` };
      m.replied = true;
      log("replyToBuyerMessage", `${messageId} to ${m.buyerUsername}: "${body.slice(0, 60)}${body.length > 60 ? "..." : ""}"`);
      return { ok: true, dryRun: false, detail: `[MOCK] Reply sent to ${m.buyerUsername} for message ${messageId}.` };
    },
  };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/** Test-only escape hatch to reset the mock store between integration test scenarios. */
export function resetMockEbayStore(): void {
  listings = seedListings();
  messages = seedMessages();
  nextSkuNum = 100;
}
