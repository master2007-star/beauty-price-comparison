export type ProviderId = "serpapi" | "searchapi" | "serper" | "searlo";

export const PROVIDER_IDS: ProviderId[] = ["serpapi", "searchapi", "serper", "searlo"];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  serpapi: "SerpApi",
  searchapi: "SearchApi.io",
  serper: "Serper",
  searlo: "Searlo",
};

/** One priced (or unpriced) listing as normalised from a provider. */
export interface RawOffer {
  price: number | null;
  /** Provider's own display string, when available. */
  priceLabel: string | null;
  currency: string | null;
  store: string;
  title: string;
  provider: ProviderId;
  productUrl: string | null;
  directUrl: string | null;
  rating: number | null;
  reviews: number | null;
  imageUrl: string | null;
  catalogId: string | null;
  productId: string | null;
  productToken: string | null;
  /** SerpApi immersive_product_page_token: the page_token for the google_immersive_product engine. */
  immersiveToken: string | null;
}

/** A priced offer as returned to the client. */
export interface Offer {
  price: number;
  priceLabel: string;
  currency: string;
  store: string;
  title: string;
  provider: ProviderId;
  productUrl: string | null;
  directUrl: string | null;
  rating: number | null;
  reviews: number | null;
  imageUrl: string | null;
  catalogId: string | null;
  productId: string | null;
  productToken: string | null;
  /** SerpApi immersive_product_page_token: the page_token for the google_immersive_product engine. */
  immersiveToken: string | null;
  /** True when this is the cheapest offer in its group. */
  isCheapest?: boolean;
  /** "+₹X vs lowest" for non-cheapest offers, null for the cheapest. */
  deltaLabel?: string | null;
}

export interface ProductGroup {
  id: string;
  title: string;
  imageUrl: string | null;
  currency: string;
  lowestPrice: number;
  lowestLabel: string;
  highestPrice: number;
  highestLabel: string;
  storeCount: number;
  savingsLabel: string;
  savingsPercent: number;
  rating: number | null;
  reviews: number | null;
  offers: Offer[];
}

export interface ProviderError {
  provider: ProviderId;
  message: string;
}

export interface SearchResponse {
  query: string;
  status: "ok" | "no_providers" | "error";
  providersUsed: ProviderId[];
  providerErrors: ProviderError[];
  groups: ProductGroup[];
  offers: Offer[];
  searchedAt: string;
  message?: string;
}

export interface CompareResult {
  query: string;
  status: SearchResponse["status"];
  providersUsed: ProviderId[];
  providerErrors: ProviderError[];
  groups: ProductGroup[];
  offers: Offer[];
}

/** A product that appears in more than one of the compared queries. */
export interface AlignedMatch {
  key: string;
  title: string;
  imageUrl: string | null;
  currency: string;
  perQuery: Array<{
    query: string;
    lowestPrice: number | null;
    lowestLabel: string | null;
    storeCount: number;
  }>;
}

export interface CompareResponse {
  queries: string[];
  results: CompareResult[];
  aligned: AlignedMatch[];
  searchedAt: string;
}

export interface ResolveLinksRequest {
  productId?: string;
  catalogId?: string;
  /** Pooled ids from the enclosing group, clicked offer's ids first. */
  productIds?: string[];
  catalogIds?: string[];
  productToken?: string;
  productTokens?: string[];
  /** Pooled SerpApi immersive_product_page_token values from the enclosing group, clicked offer's first. */
  immersiveTokens?: string[];
  store?: string;
  price?: number;
}

export interface ResolveLinksResponse {
  directUrl: string | null;
  matchedStore: string | null;
  source: ProviderId | null;
  reason?: string;
}

/** One row's live-price refresh request: the same identity shape
 *  resolve-links takes, plus the client's row key. The client never
 *  supplies a URL — the server resolves one from the identities. */
export interface RefreshPricesItem {
  key: string;
  store: string;
  price: number;
  productId?: string;
  catalogId?: string;
  /** Pooled ids from the enclosing group, clicked offer's ids first. */
  productIds?: string[];
  catalogIds?: string[];
  productToken?: string;
  productTokens?: string[];
  /** Pooled SerpApi immersive_product_page_token values from the enclosing group, clicked offer's first. */
  immersiveTokens?: string[];
}

export interface RefreshPricesResult {
  key: string;
  status: "live" | "unavailable";
  livePrice: number | null;
  currency: string | null;
  /** The server-resolved store page URL for this row, when the
   *  resolver produced one — returned even when the price fetch
   *  failed, so the client can open the store page without a second
   *  resolve round-trip. Never a client-supplied URL and never a
   *  Google Shopping productUrl. */
  directUrl?: string;
}

export interface RefreshPricesRequest {
  items: RefreshPricesItem[];
}

export interface RefreshPricesResponse {
  results: RefreshPricesResult[];
}

export interface StatusResponse {
  region: string;
  language: string;
  passcodeSet: boolean;
  /** True when GEMINI_API_KEY is set, i.e. the AI advisor + smart search are available. */
  geminiConfigured: boolean;
  providers: Record<ProviderId, { configured: boolean; last4: string | null }>;
}

/** One turn of an AI advisor conversation. */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AskRequest {
  message: string;
  history?: ChatTurn[];
}

export interface AskResponse {
  status: "ok" | "error" | "not_configured";
  /** The assistant's answer, when status is "ok". */
  answer?: string;
  /** The product query that was searched, or null for a general answer. */
  searchQuery?: string | null;
  /** Real ProductGroups from runSearch, same shape as /api/search. */
  groups?: ProductGroup[];
  /** Short plain message when status is "error". */
  message?: string;
}

export interface SmartSearchRequest {
  query: string;
}

export interface SmartSearchResponse {
  status: "ok" | "error" | "not_configured";
  rewrittenQuery?: string;
}
