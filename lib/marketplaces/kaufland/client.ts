import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Kaufland Seller API client (https://sellerapi.kaufland.com/v2).
 * Auth: per-request HMAC signature over `${METHOD}\n${URL}\n${BODY}\n${TIMESTAMP}` with the
 * shop secret key, sent in Shop-Client-Key / Shop-Timestamp / Shop-Signature headers.
 */

// Env values may be wrapped in quotes / trailing ';' (KAUFLAND_API = 'https://…';) — sanitize.
const clean = (v?: string) => (v || '').trim().replace(/^['"]+/, '').replace(/['";]+$/, '').trim();

const BASE = clean(process.env.KAUFLAND_API) || 'https://sellerapi.kaufland.com/v2';
const CLIENT_KEY = clean(process.env.KAUFLAND_API_CLIENT_KEY);
const SECRET = clean(process.env.KAUFLAND_API_SECRET_KEY);
const STOREFRONT = clean(process.env.KAUFLAND_STOREFRONT) || 'pl';

function sign(method: string, url: string, body: string, ts: number): string {
  const plain = `${method}\n${url}\n${body}\n${ts}`;
  return crypto.createHmac('sha256', SECRET).update(plain, 'utf8').digest('hex');
}

async function request<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  path: string,
  params?: Record<string, string | number>,
  data?: unknown
): Promise<T> {
  if (!CLIENT_KEY || !SECRET) throw new Error('Kaufland: brak KAUFLAND_API_CLIENT_KEY / KAUFLAND_API_SECRET_KEY w .env');
  const ts = Math.floor(Date.now() / 1000);
  const qs = params && Object.keys(params).length
    ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))).toString()
    : '';
  const url = `${BASE}${path}${qs}`;
  const body = data != null ? JSON.stringify(data) : '';
  const signature = sign(method, url, body, ts);
  try {
    const res = await axios.request<T>({
      method, url, data: data ?? undefined,
      headers: {
        'Shop-Client-Key': CLIENT_KEY,
        'Shop-Timestamp': String(ts),
        'Shop-Signature': signature,
        Accept: 'application/json',
        'User-Agent': 'mebel-panel/1.0',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      timeout: 30000,
    });
    return res.data;
  } catch (err: unknown) {
    const axErr = err as { response?: { status?: number; data?: unknown } };
    if (axErr.response) {
      const detail = JSON.stringify(axErr.response.data);
      throw new Error(`Kaufland API ${method} ${path} → ${axErr.response.status}: ${detail}`);
    }
    throw err;
  }
}

export interface KauflandUnit {
  id_unit?: string | number;
  id_offer?: string;            // seller offer SKU
  status?: string;              // 'AVAILABLE' | …
  note?: string;                // offer title/note
  ean?: string | string[];
  listing_price?: number;       // minor units (grosze)
  amount?: number;
  condition?: string;
  is_live?: boolean;            // false = unit exists but NOT visible on Kaufland.pl for customers
  product?: { title?: string; eans?: string[]; ean?: string | string[] };
  [k: string]: unknown;
}

// Cache całego drzewa kategorii (PL ~6000+). Trzyma w pamięci procesu serwera; TTL 1h.
const CAT_TREE_TTL_MS = 60 * 60 * 1000;
let _catTreeCache: { at: number; cats: KauflandCategory[] } | null = null;
let _catTreeInFlight: Promise<KauflandCategory[]> | null = null;

export const KauflandClient = {
  storefront: STOREFRONT,
  hasCreds: () => Boolean(CLIENT_KEY && SECRET),

  async getUnits(offset = 0, limit = 100): Promise<{ units: KauflandUnit[]; total: number }> {
    const data = await request<{ data?: KauflandUnit[]; pagination?: { total?: number } }>(
      'GET', '/units', { storefront: STOREFRONT, limit, offset, embedded: 'products' }
    );
    return { units: data.data ?? [], total: Number(data.pagination?.total ?? (data.data?.length ?? 0)) };
  },

  async getUnit(idUnit: string): Promise<KauflandUnit | null> {
    try {
      const data = await request<{ data?: KauflandUnit }>('GET', `/units/${encodeURIComponent(idUnit)}`, { storefront: STOREFRONT });
      return data.data ?? null;
    } catch { return null; }
  },

  /** Update price (PLN) + quantity of a unit. Kaufland prices are in minor units (grosze). */
  async updateUnit(idUnit: string, price: number, amount: number): Promise<void> {
    await request('PATCH', `/units/${encodeURIComponent(idUnit)}`, { storefront: STOREFRONT },
      { listing_price: Math.round(price * 100), amount });
  },

  /** Find a unit by seller's id_offer. Returns null when not found. */
  async findUnitByOffer(idOffer: string): Promise<KauflandUnit | null> {
    try {
      const data = await request<{ data?: KauflandUnit[] }>(
        'GET', '/units', { storefront: STOREFRONT, id_offer: idOffer, limit: 1 });
      return data.data?.[0] ?? null;
    } catch { return null; }
  },

  // ── Categories (storefront=pl required) ────────────────────────────────────
  /**
   * Pobiera kategorie (dzieci `idParent` albo całe drzewo, gdy brak parenta).
   * API Kauflandu twardo limituje `limit` do 100 (inaczej 400 „max 100"), a drzewo PL
   * ma ~6000+ pozycji — więc stronicujemy przez `offset` aż do wyczerpania.
   * `maxItems` ogranicza łączną liczbę (domyślnie bez limitu).
   */
  async getCategories(idParent?: number, maxItems = Infinity): Promise<KauflandCategory[]> {
    const PAGE = 100; // twardy limit API
    const out: KauflandCategory[] = [];
    for (let offset = 0; out.length < maxItems; offset += PAGE) {
      const params: Record<string, string | number> = { storefront: STOREFRONT, limit: PAGE, offset };
      if (idParent != null) params.id_parent_category = idParent;
      const data = await request<{ data?: KauflandCategory[]; pagination?: { total?: number } }>('GET', '/categories', params);
      const batch = data.data ?? [];
      out.push(...batch);
      const total = Number(data.pagination?.total ?? out.length);
      if (batch.length < PAGE || out.length >= total) break;
    }
    return Number.isFinite(maxItems) ? out.slice(0, maxItems) : out;
  },

  /**
   * Całe drzewo kategorii (storefront PL) z cache w pamięci procesu — do wyszukiwania po frazie.
   * Pierwsze pobranie stronicuje ~6000+ pozycji; strony po 1. pobieramy RÓWNOLEGLE (partiami),
   * żeby skrócić czas dopasowania AI (wcześniej ~61 żądań sekwencyjnie). Współbieżny lot in-flight
   * jest współdzielony, więc równoległe wywołania nie powielają pełnego pobrania.
   */
  async getAllCategories(force = false): Promise<KauflandCategory[]> {
    if (!force && _catTreeCache && (Date.now() - _catTreeCache.at) < CAT_TREE_TTL_MS) return _catTreeCache.cats;
    // Snapshot z dysku (mirakl_data/kaufland/categories.json) — natychmiastowy, bez żądań do API.
    // Odświeżaj: `node scripts/fetch-kaufland-categories.js`. API to tylko fallback, gdy brak pliku.
    if (!force) {
      try {
        const file = path.join(process.cwd(), 'mirakl_data', 'kaufland', 'categories.json');
        const cats = JSON.parse(fs.readFileSync(file, 'utf8')) as KauflandCategory[];
        if (Array.isArray(cats) && cats.length) {
          _catTreeCache = { at: Date.now(), cats };
          return cats;
        }
      } catch { /* brak snapshotu → fallback do API poniżej */ }
    }
    if (!force && _catTreeInFlight) return _catTreeInFlight;
    const PAGE = 100, CONCURRENCY = 8;
    const fetchPage = async (offset: number): Promise<KauflandCategory[]> => {
      const data = await request<{ data?: KauflandCategory[]; pagination?: { total?: number } }>(
        'GET', '/categories', { storefront: STOREFRONT, limit: PAGE, offset });
      return data.data ?? [];
    };
    const load = (async () => {
      // 1. strona — poznajemy `total`, resztę liczymy z offsetów.
      const firstData = await request<{ data?: KauflandCategory[]; pagination?: { total?: number } }>(
        'GET', '/categories', { storefront: STOREFRONT, limit: PAGE, offset: 0 });
      const out: KauflandCategory[] = [...(firstData.data ?? [])];
      const total = Number(firstData.pagination?.total ?? out.length);
      const offsets: number[] = [];
      for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
      for (let i = 0; i < offsets.length; i += CONCURRENCY) {
        const pages = await Promise.all(offsets.slice(i, i + CONCURRENCY).map((o) => fetchPage(o).catch(() => [])));
        for (const p of pages) out.push(...p);
      }
      _catTreeCache = { at: Date.now(), cats: out };
      return out;
    })();
    _catTreeInFlight = load;
    try { return await load; } finally { _catTreeInFlight = null; }
  },

  async getCategory(idCategory: number): Promise<KauflandCategory | null> {
    try {
      const data = await request<{ data?: KauflandCategory }>('GET', `/categories/${idCategory}`, { storefront: STOREFRONT });
      return data.data ?? null;
    } catch { return null; }
  },

  /**
   * Catalog attributes (Kaufland exposes a single global attribute catalog — `id_category`
   * does NOT filter and there is no per-category `required` flag). Returned for reference/AI hints.
   */
  async getAttributes(offset = 0, limit = 100): Promise<KauflandAttribute[]> {
    const data = await request<{ data?: KauflandAttribute[] }>('GET', '/attributes', { storefront: STOREFRONT, offset, limit });
    return data.data ?? [];
  },

  /**
   * Wyślij dane produktu do katalogu Kaufland (tytuł, opis, zdjęcia, producent).
   * WYMAGA locale=de-DE — Kaufland traktuje wersję de-DE jako bazową; bez niej status
   * "missing: Hersteller/Titel/Beschreibung/Bild" i produkt nie wychodzi live.
   * Wysyłamy dwa razy: de-DE (wymagane) + pl-PL (dla polskiego storefront).
   */
  async submitProductData(input: KauflandProductData): Promise<void> {
    const a: Record<string, unknown> = {
      title: [input.title],
      manufacturer: [input.manufacturer],
    };
    if (input.mpn)               a.mpn = [input.mpn];
    if (input.description)       a.description = [input.description];
    if (input.short_description) a.short_description = [input.short_description];
    if (input.images?.length)    a.picture = input.images;
    if (input.category)          a.category = [input.category];
    if (input.colour)            a.colour = [input.colour];
    if (input.material)          a.material = [input.material];
    if (input.wood_type)         a.wood_type = [input.wood_type];
    if (input.width)             a.width = [input.width];
    if (input.height)            a.height = [input.height];
    if (input.depth)             a.depth = [input.depth];
    if (input.length)            a.length = [input.length];
    if (input.weight)            a.weight = [input.weight];
    if (input.form)              a.form = [input.form];
    if (input.surface_style)     a.surface_style = [input.surface_style];
    if (input.suitable_for_location) a.suitable_for_location = [input.suitable_for_location];
    if (input.extendable != null) a.extendable = [String(input.extendable)];
    if (input.foldable != null)   a.foldable = [String(input.foldable)];
    if (input.model)             a.model = [input.model];
    if (input.product_dimensions) a.product_dimensions = [input.product_dimensions];
    if (input.package_included)  a.package_included = [input.package_included];
    const body = { ean: [input.ean], attributes: a };
    // de-DE wymagane przez Kaufland jako baza katalogu
    await request('PUT', '/product-data/', { locale: 'de-DE' }, body);
    // pl-PL dla polskiego storefront (opis w języku klienta)
    await request('PUT', '/product-data/', { locale: 'pl-PL' }, body).catch(() => {/* non-fatal */});
  },

  /** Sprawdź status przetwarzania product data dla EAN. */
  async getProductDataStatus(ean: string): Promise<{ status: string; missing: string[] } | null> {
    try {
      const data = await request<{ data?: { update_status?: string; missing_attributes?: string[] } }>(
        'GET', `/product-data/status/${encodeURIComponent(ean)}`, { locale: 'de-DE' });
      return { status: data.data?.update_status ?? 'UNKNOWN', missing: data.data?.missing_attributes ?? [] };
    } catch { return null; }
  },

  async getShippingGroups(): Promise<KauflandShippingGroup[]> {
    const data = await request<{ data?: KauflandShippingGroup[] }>('GET', '/shipping-groups', { storefront: STOREFRONT });
    return data.data ?? [];
  },

  async getWarehouses(): Promise<KauflandWarehouse[]> {
    const data = await request<{ data?: KauflandWarehouse[] }>('GET', '/warehouses', { storefront: STOREFRONT });
    return data.data ?? [];
  },

  /** Create an offer (unit). Prices in PLN are converted to grosze. Product is EAN-matched in catalog.
   *  storefront ONLY in query params (400 if also in body). id_category not accepted by POST /units. */
  async createUnit(input: KauflandCreateUnit): Promise<KauflandUnit> {
    const body: Record<string, unknown> = {
      id_offer: input.id_offer,
      ean: input.ean,
      condition: input.condition ?? 'NEW',
      listing_price: Math.round(input.price * 100),
      amount: input.amount,
      handling_time: input.handling_time ?? 1,
      id_shipping_group: input.id_shipping_group,
      id_warehouse: input.id_warehouse,
    };
    if (input.minimum_price != null) body.minimum_price = Math.round(input.minimum_price * 100);
    if (input.note) body.note = input.note;
    // id_category → excess property rejected by API (POST /units body schema)
    const data = await request<{ data?: KauflandUnit }>('POST', '/units', { storefront: STOREFRONT }, body);
    return (data.data ?? data) as KauflandUnit;
  },

  /** Withdraw (delete) an offer from Kaufland by unit id. */
  async deleteUnit(idUnit: string): Promise<void> {
    await request('DELETE', `/units/${encodeURIComponent(idUnit)}`, { storefront: STOREFRONT });
  },
};

export interface KauflandCategory {
  id_category: number; name: string; title_singular?: string; title_plural?: string;
  level?: number; is_leaf?: boolean; id_parent_category?: number; vat?: number;
}
export interface KauflandAttribute {
  id: number; name: string; title?: string; explanation?: string;
  is_multiple?: boolean; is_sharedset?: boolean; type?: string; seller_instructions?: string;
}
export interface KauflandShippingGroup { id_shipping_group: number; name: string; is_default?: boolean; }
export interface KauflandWarehouse { id_warehouse: number; name: string; is_default?: boolean; }
export interface KauflandProductData {
  ean: string;
  title: string;
  manufacturer: string;
  mpn?: string;
  description?: string;
  short_description?: string;
  images?: string[];
  category?: string;
  // Category-specific (furniture)
  colour?: string;
  material?: string;
  wood_type?: string;
  width?: string;
  height?: string;
  depth?: string;
  length?: string;
  weight?: string;
  form?: string;
  surface_style?: string;
  suitable_for_location?: string;
  extendable?: boolean;
  foldable?: boolean;
  model?: string;
  product_dimensions?: string;
  package_included?: string;
}

export interface KauflandCreateUnit {
  id_offer: string; ean: string; price: number; amount: number;
  condition?: string; minimum_price?: number; handling_time?: number; note?: string;
  id_shipping_group: number; id_warehouse: number;
  // id_category removed — POST /units rejects it as excess property
}
