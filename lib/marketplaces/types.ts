import type { MarketplaceKind, TyreProduct } from '@/types';

/** Normalized category node across marketplaces (Allegro category id / Mirakl category code). */
export interface MarketplaceCategory {
  code: string;
  label: string;
  parentCode?: string | null;
  leaf: boolean;
}

/** Normalized category attribute/parameter across marketplaces. */
export interface MarketplaceAttribute {
  code: string;
  label: string;
  type: string;
  required: boolean;
  multiple?: boolean;
  values?: { code: string; label: string }[];
}

/** Input for publishing/updating an offer. `formData` shape depends on the marketplace. */
export interface OfferDraft {
  offerId: number;            // local allegro_offers.id
  product?: TyreProduct | null;
  formData: Record<string, unknown>;
  basePrice?: number | null;
}

/** Marketplace-side reference(s) produced by a publish. */
export interface PublishOutcome {
  /** Primary live reference (Allegro offer id, or Mirakl shop_sku/offer ref). */
  ref: string;
  /** Async import ids (Mirakl). Undefined for synchronous marketplaces. */
  productImportId?: string;
  offerImportId?: string;
  /** Coarse status right after submit: 'active' (sync) or 'pending' (async). */
  status: 'active' | 'pending' | 'error';
  raw?: unknown;
}

export interface LiveStatus {
  status: string;
  title?: string | null;
  raw?: unknown;
}

/** A live offer fetched from a marketplace (Mirakl OF21 / Kaufland units) for compare/sync. */
export interface LiveOfferRow {
  ref: string;            // edit key: shop_sku (Mirakl) | id_unit (Kaufland)
  offerId: string | null; // native marketplace offer id
  title: string | null;
  ean: string | null;
  sku: string;
  price: number | null;
  quantity: number | null;
  state: string;          // 'active' | 'inactive'
  stateCode: string;
  leadtime?: number;
  logisticClass?: string;
  category: string | null;
  raw?: Record<string, unknown>;
}

/** Engines that expose a live-offer feed (Mirakl, Kaufland) — used by sync/compare endpoints. */
export interface LiveOffersAdapter {
  listLiveOffers(offset: number, limit: number): Promise<{ total: number; offers: LiveOfferRow[] }>;
  updateOfferByRef(
    row: { ref: string; ean?: string | null; stateCode?: string; leadtime?: number; logisticClass?: string },
    price: number,
    quantity: number
  ): Promise<string>;
}

/**
 * Common surface every marketplace integration implements. Allegro wraps the existing
 * `lib/allegro.ts`; Mirakl operators (Empik + others) share one generic implementation.
 */
export interface MarketplaceAdapter {
  readonly kind: MarketplaceKind;
  readonly accountId: string;
  /** Mirakl operator id (e.g. 'empik'); undefined for Allegro. */
  readonly operator?: string;

  getCategories(parentCode?: string): Promise<MarketplaceCategory[]>;
  searchCategories(phrase: string): Promise<MarketplaceCategory[]>;
  getCategoryAttributes(categoryCode: string): Promise<MarketplaceAttribute[]>;

  publish(draft: OfferDraft): Promise<PublishOutcome>;
  updateLive(ref: string, draft: OfferDraft): Promise<void>;
  /** Withdraw/end an offer on the marketplace (Mirakl delete, Allegro END, Kaufland DELETE unit). */
  withdraw?(ref: string): Promise<string>;
  /** Poll live/import status for a given marketplace reference. */
  syncStatus(ref: string, extra?: { productImportId?: string; offerImportId?: string }): Promise<LiveStatus>;
}
