import { createMockEbayClient } from "./mockClient.js";
import { createRealEbayClient } from "./realClient.js";
import type { EbayClient } from "./types.js";

export type { EbayClient } from "./types.js";
export * from "./types.js";

let cached: EbayClient | null = null;

/**
 * Picks the real eBay client when credentials are configured, otherwise the mock one --
 * exactly mirroring llm/client.ts's getLlmProvider() pattern. Real or mock, mutating
 * actions additionally require EBAY_LIVE_MODE=true (see realClient.ts); that default-off
 * safety gate is what actually protects the seller's live account, not the presence of
 * credentials alone.
 */
export function getEbayClient(): EbayClient {
  if (cached) return cached;

  const clientId = process.env.EBAY_CLIENT_ID?.trim();
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim();
  const refreshToken = process.env.EBAY_REFRESH_TOKEN?.trim();

  if (clientId && clientSecret && refreshToken) {
    const env = process.env.EBAY_ENV === "production" ? "production" : "sandbox";
    cached = createRealEbayClient({
      clientId,
      clientSecret,
      refreshToken,
      env,
      marketplaceId: process.env.EBAY_MARKETPLACE_ID?.trim() || "EBAY_US",
      merchantLocationKey: process.env.EBAY_MERCHANT_LOCATION_KEY?.trim() || "default",
      liveActionsEnabled: process.env.EBAY_LIVE_MODE === "true",
    });
  } else {
    cached = createMockEbayClient();
  }
  return cached;
}
