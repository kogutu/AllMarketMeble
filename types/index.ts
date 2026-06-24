/** A gallery image from the furniture (meble) Typesense collection. */
export interface MebleImage {
  url: string;
  alt?: string;
  position?: number;
}

/**
 * Furniture product (kolekcja Typesense „meble"). Raw documents are normalized by
 * `normalizeMebleProduct` (lib/typesense.ts), which fills the compat fields below
 * (price_gross, gallery_images, attrs, extra_json, kind) used across the app.
 */
export interface MebleProduct {
  // ── Raw furniture fields ──────────────────────────────────────────────────
  id: string;
  pid?: number;
  name: string;
  subtitle?: string;
  sku: string;
  ean: string;
  model: string;
  slug?: string;
  url?: string;
  description: string;            // HTML
  // pricing (PLN, gross)
  finalprice: number;
  regularprice: number;
  discountamount?: number;
  discountpercent?: number;
  // stock
  qty: number;
  // media
  img: string;
  imgs: MebleImage[];
  // categories
  cats: string[];                 // np. ["151_biurka"]
  breadcrumbs?: string;
  // shipping / dimensions / warranty
  shipping_amount?: number;
  cbm?: number;
  warranty?: string;
  wysylka?: { width?: number[]; height?: number[]; length?: number[]; weight?: number[]; packs?: string };
  // attributes
  charakterystyka?: Record<string, unknown>[];
  specyfikacja?: Record<string, unknown>[];
  color?: { name?: string; hex?: string; gradient_css?: string };
  // flags
  enabled?: boolean;
  is_set?: boolean;
  isnew?: boolean;
  ispromo?: boolean;
  supplier?: string;

  // ── Normalized / compat fields (filled by normalizeMebleProduct) ──────────
  price_gross: number;            // = finalprice
  price_net: number;              // = finalprice / 1.23
  condition: string;              // 'new' (meble)
  kind: string;                   // główna kategoria, do dopasowania marż
  shipping_cost: number;          // = shipping_amount
  brand?: string;                 // meble: zwykle puste (pełna nazwa w `name`)
  gallery_images: string[];       // = imgs[].url
  attrs: Record<string, string>;  // spłaszczone charakterystyka + specyfikacja
  extra_json: {
    image: string;
    gallery_images: string[];
    description: string;
    attrs: Record<string, string>;
    offer_qty: number;
    ebay_category?: Record<string, string>;
    [k: string]: unknown;
  };

  // ── Legacy (opony) — opcjonalne, używane jeszcze przez kod Allegro ─────────
  width?: string; profile?: string; diameter?: string; season?: string;
  load_index?: string; speed_index?: string; vehicle_class?: string;
  size_raw?: string; production_year?: string; xl?: number; runflat?: number; reinforced?: number;
  wet_grip?: string; rolling_resistance?: string; pattern?: string;
}

/** @deprecated Pozostawiony alias na czas migracji kodu Allegro. Używaj `MebleProduct`. */
export type TyreProduct = MebleProduct;

/** Engine that backs a marketplace (auth + API model). */
export type MarketplaceEngine = 'allegro' | 'mirakl' | 'kaufland';
/** User-facing marketplace identifier: 'allegro' | 'empik' | 'brw' | 'kaufland' | … */
export type MarketplaceSlug = string;
/** @deprecated Use MarketplaceEngine. Kept for existing call sites. */
export type MarketplaceKind = MarketplaceEngine;

export interface AllegroOffer {
  id: number;
  typesense_id: string;
  typesense_collection: string;
  marketplace: MarketplaceKind;
  allegro_offer_id: string | null;
  status: 'draft' | 'pending' | 'active' | 'ended' | 'error';
  account_id: string | null;
  category_id: string | null;
  title: string | null;
  description: string | null;
  price: number | null;
  base_price: number | null;
  quantity: number;
  form_data: AllegroFormData | MiraklFormData | null;
  allegro_response: Record<string, unknown> | null;
  error_message: string | null;
  // Mirakl async-import tracking (null for Allegro offers)
  mirakl_shop_sku?: string | null;
  mirakl_product_import_id?: string | null;
  mirakl_offer_import_id?: string | null;
  mirakl_state?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AllegroFormData {
  title: string;
  sku: string;
  categoryId: string;
  categoryName: string;
  description: string;
  price: number;
  quantity: number;
  quantity_in_set: number;
  condition: 'NEW' | 'USED';
  images: string[];
  shippingCost: number;
  shippingTime: string;
  // All category parameters: paramId → dictEntryId (string) or value, or [] for multi-choice
  params: Record<string, string | string[]>;
  // Per-account title overrides (accountId → title). Falls back to `title` if absent.
  accountTitles?: Record<string, string>;
  // Invoice type: VAT for new tyres, VAT_MARGIN for used. Auto-set from condition, overridable.
  invoice?: 'VAT' | 'VAT_MARGIN';
  // Per-account selected shipping rate ID (accountId → shippingRateId).
  shippingRateIds?: Record<string, string>;
}

// ── Mirakl (Empik & other Mirakl operators) ────────────────────────────────

/** Form data for a Mirakl offer/product. `attributes` are operator category attribute codes. */
export interface MiraklFormData {
  title: string;
  sku: string;
  ean?: string;
  // Operator category code (Mirakl H11 hierarchy), not an Allegro category id.
  categoryCode: string;
  categoryLabel: string;
  description: string;
  price: number;
  quantity: number;
  condition: 'NEW' | 'USED';
  images: string[];
  logisticClass?: string;
  leadtimeToShip?: number;
  // Mirakl category attribute code → value (or value-list code), or [] for multi-value.
  attributes: Record<string, string | string[]>;
}

/** A category attribute exposed by a Mirakl operator (normalized from CM/AT + value lists). */
export interface MiraklAttributeDef {
  code: string;
  label: string;
  type: string;            // TEXT | LIST | LIST_MULTIPLE_VALUES | DECIMAL | INTEGER | BOOLEAN ...
  required: boolean;
  valueListCode?: string;
  values?: { code: string; label: string }[];
}

export interface MiraklCategoryNode {
  code: string;
  label: string;
  parentCode?: string | null;
  leaf: boolean;
}

export interface AllegroCategory {
  id: string;
  name: string;
  parent?: { id: string; name: string };
  leaf: boolean;
}

export interface AllegroToken {
  access_token: string;
  refresh_token?: string;
  expires_at: string;
}

export interface ValidationResult {
  valid: boolean;
  score: number;
  issues: string[];
  suggestions: string[];
  summary: string;
}
