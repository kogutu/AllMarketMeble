import axios from 'axios';
import crypto from 'crypto';

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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
  product?: { title?: string; eans?: string[]; ean?: string | string[] };
  [k: string]: unknown;
}

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

  // ── Categories (storefront=pl required) ────────────────────────────────────
  async getCategories(idParent?: number, limit = 200): Promise<KauflandCategory[]> {
    const params: Record<string, string | number> = { storefront: STOREFRONT, limit };
    if (idParent != null) params.id_parent_category = idParent;
    const data = await request<{ data?: KauflandCategory[] }>('GET', '/categories', params);
    return data.data ?? [];
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

  async getShippingGroups(): Promise<KauflandShippingGroup[]> {
    const data = await request<{ data?: KauflandShippingGroup[] }>('GET', '/shipping-groups', { storefront: STOREFRONT });
    return data.data ?? [];
  },

  async getWarehouses(): Promise<KauflandWarehouse[]> {
    const data = await request<{ data?: KauflandWarehouse[] }>('GET', '/warehouses', { storefront: STOREFRONT });
    return data.data ?? [];
  },

  /** Create an offer (unit). Prices in PLN are converted to grosze. Product is EAN-matched in catalog. */
  async createUnit(input: KauflandCreateUnit): Promise<KauflandUnit> {
    const body: Record<string, unknown> = {
      storefront: STOREFRONT,
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
    if (input.id_category != null) body.id_category = input.id_category;
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
export interface KauflandCreateUnit {
  id_offer: string; ean: string; price: number; amount: number;
  condition?: string; minimum_price?: number; handling_time?: number; note?: string;
  id_shipping_group: number; id_warehouse: number; id_category?: number;
}
