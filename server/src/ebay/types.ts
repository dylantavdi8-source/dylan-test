// Domain types for the eBay integration layer. Shared by the real client, the mock
// client, and the tool layer -- agents only ever see these shapes, never raw eBay
// API request/response formats.

export interface EbayListing {
  sku: string;
  offerId: string;
  listingId: string | null; // null until published
  title: string;
  description: string;
  categoryId: string;
  price: number;
  currency: string;
  quantity: number;
  quantitySold: number;
  status: "draft" | "active" | "ended";
  /** Floor price the seller has set -- selling below this should be flagged, never silently allowed. */
  floorPrice: number | null;
  marketplaceId: string;
  updatedAt: number;
}

export interface CreateListingInput {
  title: string;
  description: string;
  categoryId: string;
  price: number;
  quantity: number;
  sku?: string;
  floorPrice?: number;
}

export interface CompetitorListing {
  title: string;
  price: number;
  currency: string;
  condition: string;
  itemWebUrl: string;
  seller: string;
}

export interface EbayOrder {
  orderId: string;
  sku: string;
  title: string;
  quantity: number;
  price: number;
  buyerUsername: string;
  status: "pending" | "shipped" | "delivered" | "cancelled";
  createdAt: number;
}

export interface BuyerMessage {
  messageId: string;
  sku: string | null;
  listingTitle: string | null;
  buyerUsername: string;
  subject: string;
  body: string;
  receivedAt: number;
  replied: boolean;
}

export interface BuyerOffer {
  offerId: string;
  sku: string;
  listingTitle: string | null;
  buyerUsername: string;
  offerPrice: number;
  listingPrice: number;
  receivedAt: number;
  status: "pending" | "accepted" | "declined" | "countered";
}

export interface ActionResult {
  ok: boolean;
  dryRun: boolean;
  detail: string;
}

/**
 * Everything an agent tool can do against eBay. Implemented once for real (realClient.ts,
 * live HTTP calls against eBay's REST/Trading APIs) and once for mock (mockClient.ts, an
 * in-memory deterministic store) -- see ebay/index.ts for how the mode is chosen.
 */
export interface EbayClient {
  readonly mode: "live" | "mock";
  /** Whether mutating actions (create/update/end listing, price/qty change, send message)
   *  actually call eBay, vs. simulate and report what *would* happen. Independent of
   *  `mode` -- even a fully configured live client defaults to dry-run until the operator
   *  explicitly opts in via EBAY_LIVE_MODE=true. */
  readonly liveActionsEnabled: boolean;

  listListings(): Promise<EbayListing[]>;
  getListing(sku: string): Promise<EbayListing | null>;
  createListing(input: CreateListingInput): Promise<{ listing: EbayListing; result: ActionResult }>;
  updateListingDetails(sku: string, patch: { title?: string; description?: string }): Promise<ActionResult>;
  updateListingPrice(sku: string, price: number): Promise<ActionResult>;
  updateListingQuantity(sku: string, quantity: number): Promise<ActionResult>;
  endListing(sku: string, reason: string): Promise<ActionResult>;

  searchComparableListings(query: string, limit?: number): Promise<CompetitorListing[]>;

  getOrders(sinceHours?: number): Promise<EbayOrder[]>;

  getBuyerMessages(unrepliedOnly?: boolean): Promise<BuyerMessage[]>;
  replyToBuyerMessage(messageId: string, body: string): Promise<ActionResult>;

  getBuyerOffers(pendingOnly?: boolean): Promise<BuyerOffer[]>;
  respondToOffer(offerId: string, action: "accept" | "decline" | "counter", counterPrice?: number): Promise<ActionResult>;
}
