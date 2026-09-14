import type {
  EbayClient,
  EbayListing,
  CreateListingInput,
  CompetitorListing,
  EbayOrder,
  BuyerMessage,
  BuyerOffer,
  ActionResult,
} from "./types.js";

// Real eBay API integration. Built against eBay's documented REST APIs:
//   - Sell Inventory API (listings, price/quantity)          developer.ebay.com/api-docs/sell/inventory
//   - Sell Fulfillment API (orders)                          developer.ebay.com/api-docs/sell/fulfillment
//   - Buy Browse API (competitor search, app-token auth)      developer.ebay.com/api-docs/buy/browse
//   - Trading API (buyer messages -- no modern REST equivalent exists for this) via
//     the legacy api.dll XML endpoint, authenticated with the OAuth user token through
//     the X-EBAY-API-IAF-TOKEN header (eBay's documented OAuth migration path for
//     Trading API). This is the one part of this client that could NOT be verified
//     against a live account in this session -- if it errors with an auth failure,
//     the account may need a legacy Auth'n Auth "User Token" instead; see
//     developer.ebay.com/api-docs/user-guides/static/oauth-tokens.html
//
// SAFETY: every mutating method checks `liveActionsEnabled` (from EBAY_LIVE_MODE) before
// making a real write call. When false, it returns a clearly-labeled dry-run result
// without touching eBay at all, even though read calls and the token itself are real.

interface RealClientConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  env: "sandbox" | "production";
  marketplaceId: string;
  merchantLocationKey: string;
  liveActionsEnabled: boolean;
}

const REST_SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.account",
].join(" ");

function hosts(env: "sandbox" | "production") {
  return env === "sandbox"
    ? { api: "https://api.sandbox.ebay.com", trading: "https://api.sandbox.ebay.com/ws/api.dll" }
    : { api: "https://api.ebay.com", trading: "https://api.ebay.com/ws/api.dll" };
}

class TokenCache {
  private token: string | null = null;
  private expiresAt = 0;

  async get(fetcher: () => Promise<{ token: string; expiresInSec: number }>): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - 30_000) return this.token;
    const { token, expiresInSec } = await fetcher();
    this.token = token;
    this.expiresAt = Date.now() + expiresInSec * 1000;
    return token;
  }
}

export function createRealEbayClient(cfg: RealClientConfig): EbayClient {
  const { api, trading } = hosts(cfg.env);
  const userTokenCache = new TokenCache();
  const appTokenCache = new TokenCache();
  const basicAuth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");

  async function getUserToken(): Promise<string> {
    return userTokenCache.get(async () => {
      const res = await fetch(`${api}/identity/v1/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}` },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cfg.refreshToken, scope: REST_SCOPES }),
      });
      if (!res.ok) throw new Error(`eBay user token refresh failed (${res.status}): ${await res.text()}`);
      const json = (await res.json()) as { access_token: string; expires_in: number };
      return { token: json.access_token, expiresInSec: json.expires_in };
    });
  }

  async function getAppToken(): Promise<string> {
    return appTokenCache.get(async () => {
      const res = await fetch(`${api}/identity/v1/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}` },
        body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
      });
      if (!res.ok) throw new Error(`eBay app token fetch failed (${res.status}): ${await res.text()}`);
      const json = (await res.json()) as { access_token: string; expires_in: number };
      return { token: json.access_token, expiresInSec: json.expires_in };
    });
  }

  async function userJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getUserToken();
    const res = await fetch(`${api}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        "X-EBAY-C-MARKETPLACE-ID": cfg.marketplaceId,
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`eBay API ${init.method ?? "GET"} ${path} failed (${res.status}): ${await res.text()}`);
    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  }

  async function tradingCall(callName: string, bodyXml: string): Promise<string> {
    const token = await getUserToken();
    const res = await fetch(trading, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "X-EBAY-API-CALL-NAME": callName,
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "1155",
        "X-EBAY-API-IAF-TOKEN": token,
      },
      body: bodyXml,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`eBay Trading API ${callName} failed (${res.status}): ${text}`);
    return text;
  }

  function xmlTag(xml: string, tag: string): string | null {
    const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return m ? m[1] : null;
  }

  function xmlTagAll(xml: string, tag: string): string[] {
    const matches = [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))];
    return matches.map((m) => m[1]);
  }

  function escapeXml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function dryRunResult(action: string, detail: string): ActionResult {
    return { ok: true, dryRun: true, detail: `[DRY RUN -- EBAY_LIVE_MODE is not enabled] Would ${action}: ${detail}` };
  }

  async function offerToListing(offer: any, inventoryItem: any | null): Promise<EbayListing> {
    return {
      sku: offer.sku,
      offerId: offer.offerId,
      listingId: offer.listing?.listingId ?? null,
      title: inventoryItem?.product?.title ?? offer.listingDescription ?? offer.sku,
      description: inventoryItem?.product?.description ?? "",
      categoryId: offer.categoryId ?? "",
      price: Number(offer.pricingSummary?.price?.value ?? 0),
      currency: offer.pricingSummary?.price?.currency ?? "USD",
      quantity: Number(offer.availableQuantity ?? 0),
      quantitySold: 0,
      status: offer.status === "PUBLISHED" ? "active" : offer.status === "ENDED" ? "ended" : "draft",
      floorPrice: null, // eBay has no native "floor price" concept -- this is tracked by Compliance's own judgement/notes, not the API.
      marketplaceId: offer.marketplaceId ?? cfg.marketplaceId,
      updatedAt: Date.now(),
    };
  }

  return {
    mode: "live",
    liveActionsEnabled: cfg.liveActionsEnabled,

    async listListings() {
      const data = await userJson<{ offers?: any[] }>(`/sell/inventory/v1/offer?marketplace_id=${cfg.marketplaceId}&limit=100`);
      const offers = data.offers ?? [];
      const listings: EbayListing[] = [];
      for (const offer of offers) {
        let item: any = null;
        try {
          item = await userJson(`/sell/inventory/v1/inventory_item/${encodeURIComponent(offer.sku)}`);
        } catch {
          /* inventory item lookup is best-effort context; offer data alone is enough to proceed */
        }
        listings.push(await offerToListing(offer, item));
      }
      return listings;
    },

    async getListing(sku: string) {
      let item: any;
      try {
        item = await userJson(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`);
      } catch {
        return null;
      }
      const offersData = await userJson<{ offers?: any[] }>(`/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`);
      const offer = offersData.offers?.[0];
      if (!offer) return null;
      return offerToListing(offer, item);
    },

    async createListing(input: CreateListingInput) {
      const sku = input.sku ?? `SKU-${Date.now().toString(36).toUpperCase()}`;

      if (!cfg.liveActionsEnabled) {
        const simulated: EbayListing = {
          sku,
          offerId: "(not created -- dry run)",
          listingId: null,
          title: input.title,
          description: input.description,
          categoryId: input.categoryId,
          price: input.price,
          currency: "USD",
          quantity: input.quantity,
          quantitySold: 0,
          status: "draft",
          floorPrice: input.floorPrice ?? null,
          marketplaceId: cfg.marketplaceId,
          updatedAt: Date.now(),
        };
        return { listing: simulated, result: dryRunResult("create and publish a listing", `${sku} "${input.title}" @ $${input.price}`) };
      }

      await userJson(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
        method: "PUT",
        body: JSON.stringify({
          product: { title: input.title, description: input.description },
          availability: { shipToLocationAvailability: { quantity: input.quantity } },
        }),
      });

      const offerRes = await userJson<{ offerId: string }>(`/sell/inventory/v1/offer`, {
        method: "POST",
        body: JSON.stringify({
          sku,
          marketplaceId: cfg.marketplaceId,
          format: "FIXED_PRICE",
          availableQuantity: input.quantity,
          categoryId: input.categoryId,
          listingDescription: input.description,
          pricingSummary: { price: { value: input.price.toFixed(2), currency: "USD" } },
          merchantLocationKey: cfg.merchantLocationKey,
        }),
      });

      await userJson(`/sell/inventory/v1/offer/${offerRes.offerId}/publish`, { method: "POST" });

      const listing: EbayListing = {
        sku,
        offerId: offerRes.offerId,
        listingId: null,
        title: input.title,
        description: input.description,
        categoryId: input.categoryId,
        price: input.price,
        currency: "USD",
        quantity: input.quantity,
        quantitySold: 0,
        status: "active",
        floorPrice: input.floorPrice ?? null,
        marketplaceId: cfg.marketplaceId,
        updatedAt: Date.now(),
      };
      return { listing, result: { ok: true, dryRun: false, detail: `Created and published listing ${sku} (offer ${offerRes.offerId}).` } };
    },

    async updateListingDetails(sku, patch) {
      if (!cfg.liveActionsEnabled) return dryRunResult("update listing details", `${sku}: ${JSON.stringify(patch)}`);
      await userJson(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
        method: "PUT",
        body: JSON.stringify({ product: { ...(patch.title ? { title: patch.title } : {}), ...(patch.description ? { description: patch.description } : {}) } }),
      });
      return { ok: true, dryRun: false, detail: `Updated details for ${sku}.` };
    },

    async updateListingPrice(sku, price) {
      if (!cfg.liveActionsEnabled) return dryRunResult("update the price", `${sku} -> $${price.toFixed(2)}`);
      const offersData = await userJson<{ offers?: any[] }>(`/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`);
      const offerId = offersData.offers?.[0]?.offerId;
      if (!offerId) return { ok: false, dryRun: false, detail: `No offer found for SKU ${sku}.` };
      await userJson(`/sell/inventory/v1/offer/${offerId}`, {
        method: "PUT",
        body: JSON.stringify({ pricingSummary: { price: { value: price.toFixed(2), currency: "USD" } } }),
      });
      return { ok: true, dryRun: false, detail: `Updated ${sku} price to $${price.toFixed(2)}.` };
    },

    async updateListingQuantity(sku, quantity) {
      if (!cfg.liveActionsEnabled) return dryRunResult("update the quantity", `${sku} -> ${quantity}`);
      await userJson(`/sell/inventory/v1/offer/update_price_quantity`, {
        method: "POST",
        body: JSON.stringify({ requests: [{ offers: [{ sku, availableQuantity: quantity }] }] }),
      });
      return { ok: true, dryRun: false, detail: `Updated ${sku} quantity to ${quantity}.` };
    },

    async endListing(sku, reason) {
      if (!cfg.liveActionsEnabled) return dryRunResult("end the listing", `${sku} (${reason})`);
      const offersData = await userJson<{ offers?: any[] }>(`/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`);
      const offerId = offersData.offers?.[0]?.offerId;
      if (!offerId) return { ok: false, dryRun: false, detail: `No offer found for SKU ${sku}.` };
      await userJson(`/sell/inventory/v1/offer/${offerId}/withdraw`, { method: "POST" });
      return { ok: true, dryRun: false, detail: `Ended listing ${sku} (${reason}).` };
    },

    async searchComparableListings(query: string, limit = 5) {
      const token = await getAppToken();
      const res = await fetch(
        `${api}/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=${limit}`,
        { headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": cfg.marketplaceId } }
      );
      if (!res.ok) throw new Error(`eBay Browse API search failed (${res.status}): ${await res.text()}`);
      const data = (await res.json()) as { itemSummaries?: any[] };
      return (data.itemSummaries ?? []).map(
        (item): CompetitorListing => ({
          title: item.title,
          price: Number(item.price?.value ?? 0),
          currency: item.price?.currency ?? "USD",
          condition: item.condition ?? "Unknown",
          itemWebUrl: item.itemWebUrl ?? "",
          seller: item.seller?.username ?? "unknown",
        })
      );
    },

    async getOrders(sinceHours = 24 * 7) {
      const from = new Date(Date.now() - sinceHours * 3_600_000).toISOString();
      const to = new Date().toISOString();
      const data = await userJson<{ orders?: any[] }>(
        `/sell/fulfillment/v1/order?filter=${encodeURIComponent(`creationdate:[${from}..${to}]`)}&limit=100`
      );
      return (data.orders ?? []).map((o): EbayOrder => {
        const lineItem = o.lineItems?.[0] ?? {};
        return {
          orderId: o.orderId,
          sku: lineItem.sku ?? "",
          title: lineItem.title ?? "",
          quantity: Number(lineItem.quantity ?? 1),
          price: Number(lineItem.lineItemCost?.value ?? 0),
          buyerUsername: o.buyer?.username ?? "unknown",
          status:
            o.orderFulfillmentStatus === "FULFILLED"
              ? "shipped"
              : o.cancelStatus?.cancelState === "CANCELED"
              ? "cancelled"
              : "pending",
          createdAt: new Date(o.creationDate).getTime(),
        };
      });
    },

    async getBuyerMessages(unrepliedOnly = true) {
      const xml = await tradingCall(
        "GetMemberMessages",
        `<?xml version="1.0" encoding="utf-8"?>
<GetMemberMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <MailMessageType>All</MailMessageType>
  <MessageStatus>${unrepliedOnly ? "Unanswered" : "All"}</MessageStatus>
  <DetailLevel>ReturnMessages</DetailLevel>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
</GetMemberMessagesRequest>`
      );
      const blocks = xmlTagAll(xml, "MemberMessage");
      return blocks.map((block): BuyerMessage => ({
        messageId: xmlTag(block, "MessageID") ?? "",
        sku: null,
        listingTitle: xmlTag(block, "ItemSubject"),
        buyerUsername: xmlTag(block, "SenderID") ?? "unknown",
        subject: xmlTag(block, "Subject") ?? "",
        body: xmlTag(block, "Text") ?? "",
        receivedAt: (() => {
          const t = xmlTag(block, "CreationDate");
          return t ? new Date(t).getTime() : Date.now();
        })(),
        replied: xmlTag(block, "ResponseDetails") !== null,
      }));
    },

    async replyToBuyerMessage(messageId: string, body: string) {
      if (!cfg.liveActionsEnabled) return dryRunResult("reply to a buyer message", `message ${messageId}: "${body.slice(0, 80)}"`);
      await tradingCall(
        "AddMemberMessageAAQToPartner",
        `<?xml version="1.0" encoding="utf-8"?>
<AddMemberMessageAAQToPartnerRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <MemberMessage>
    <QuestionType>General</QuestionType>
    <Body>${escapeXml(body)}</Body>
    <ParentMessageID>${escapeXml(messageId)}</ParentMessageID>
  </MemberMessage>
</AddMemberMessageAAQToPartnerRequest>`
      );
      return { ok: true, dryRun: false, detail: `Replied to message ${messageId}.` };
    },

    // Best Offer negotiation, like buyer messages above, has no modern REST equivalent --
    // this uses the same legacy Trading API (GetBestOffers / RespondToBestOffer), authenticated
    // the same way. Also unverified against a live account in this session; same caveat applies.
    async getBuyerOffers(pendingOnly = true) {
      const xml = await tradingCall(
        "GetBestOffers",
        `<?xml version="1.0" encoding="utf-8"?>
<GetBestOffersRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <BestOfferStatus>${pendingOnly ? "Active" : "All"}</BestOfferStatus>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
</GetBestOffersRequest>`
      );
      const blocks = xmlTagAll(xml, "BestOffer");
      return blocks.map((block): BuyerOffer => {
        const statusRaw = (xmlTag(block, "Status") ?? "Active").toLowerCase();
        const status: BuyerOffer["status"] =
          statusRaw === "accepted" ? "accepted" : statusRaw === "declined" ? "declined" : statusRaw === "countered" ? "countered" : "pending";
        return {
          offerId: xmlTag(block, "BestOfferID") ?? "",
          sku: xmlTag(block, "SKU") ?? "",
          listingTitle: xmlTag(block, "ItemTitle"),
          buyerUsername: xmlTag(block, "Buyer") ?? "unknown",
          offerPrice: Number(xmlTag(block, "Price") ?? 0),
          listingPrice: Number(xmlTag(block, "ListingPrice") ?? 0),
          receivedAt: (() => {
            const t = xmlTag(block, "OfferTime");
            return t ? new Date(t).getTime() : Date.now();
          })(),
          status,
        };
      });
    },

    async respondToOffer(offerId: string, action: "accept" | "decline" | "counter", counterPrice?: number) {
      if (!cfg.liveActionsEnabled) return dryRunResult(`${action} a Best Offer`, `offer ${offerId}${counterPrice ? ` @ $${counterPrice.toFixed(2)}` : ""}`);
      const actionTag = action === "accept" ? "AcceptFromSeller" : action === "decline" ? "DeclineFromSeller" : "CounterFromSeller";
      const counterXml = action === "counter" && counterPrice ? `<CounterOfferPrice currencyID="USD">${counterPrice.toFixed(2)}</CounterOfferPrice>` : "";
      await tradingCall(
        "RespondToBestOffer",
        `<?xml version="1.0" encoding="utf-8"?>
<RespondToBestOfferRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <BestOfferID>${escapeXml(offerId)}</BestOfferID>
  <Action>${actionTag}</Action>
  ${counterXml}
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
</RespondToBestOfferRequest>`
      );
      return { ok: true, dryRun: false, detail: `Sent ${action} response for Best Offer ${offerId}.` };
    },
  };
}
