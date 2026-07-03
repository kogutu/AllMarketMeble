// eslint-disable-next-line @typescript-eslint/no-require-imports
const TypesenseLib = require('typesense');
import { MebleProduct, MebleImage } from '@/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTypesenseClient(): any {
  if (!client) {
    client = new TypesenseLib.Client({
      nodes: [
        {
          host: process.env.TYPESENSE_HOST || 'hd-098.stpl.net.pl',
          port: parseInt(process.env.TYPESENSE_PORT || '4010'),
          protocol: (process.env.TYPESENSE_PROTOCOL || 'http') as 'http' | 'https',
        },
      ],
      apiKey: process.env.TYPESENSE_API_KEY || 'xyz',
      connectionTimeoutSeconds: 10,
    });
  }
  return client;
}

const VAT = 1.23;

/** Flatten one specyfikacja/charakterystyka object ({ key: [values] | nested }) into key→string. */
function flattenAttrs(target: Record<string, string>, obj: Record<string, unknown> | undefined) {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, raw] of Object.entries(obj)) {
    if (Array.isArray(raw)) {
      const vals = raw.filter((v) => v != null && v !== '');
      if (vals.length) target[key] = vals.join(', ');
    } else if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
      const v = (raw as { value?: unknown }).value;
      if (Array.isArray(v) && v.length) target[key] = v.join(', ');
    } else if (raw != null && typeof raw !== 'object') {
      target[key] = String(raw);
    }
  }
}

/** Derive a stable category key for margin matching: "151_biurka" → "biurka". */
function deriveKind(raw: Partial<MebleProduct>): string {
  const cat = raw.cats?.[0] || '';
  if (cat) return cat.includes('_') ? cat.split('_').slice(1).join('_') : cat;
  if (raw.breadcrumbs) return raw.breadcrumbs.replace(/^\//, '').split('/')[0];
  return '';
}

/**
 * Normalize a raw furniture (meble) Typesense document into MebleProduct, filling the compat
 * fields the rest of the app relies on. Robust to missing fields (search returns a subset).
 */
export function normalizeMebleProduct(raw: Record<string, unknown>): MebleProduct {
  const p = raw as Partial<MebleProduct> & Record<string, unknown>;

  const imgs = (Array.isArray(p.imgs) ? p.imgs : []) as MebleImage[];
  const galleryImages = imgs.map((i) => i?.url).filter(Boolean) as string[];
  const image = (p.img as string) || galleryImages[0] || '';

  const finalprice = Number(p.finalprice ?? p.regularprice ?? 0);
  const priceGross = finalprice;
  const priceNet = Math.round((finalprice / VAT) * 100) / 100;

  const attrs: Record<string, string> = {};
  flattenAttrs(attrs, (p.charakterystyka as Record<string, unknown>[] | undefined)?.[0]);
  flattenAttrs(attrs, (p.specyfikacja as Record<string, unknown>[] | undefined)?.[0]);
  if (p.ean) attrs['ean'] = String(p.ean);
  if (p.color && typeof p.color === 'object') {
    const cname = (p.color as { name?: string }).name;
    if (cname) attrs['kolor'] = cname;
  }

  const qty = Number(p.qty ?? 0);
  const shippingCost = Number(p.shipping_amount ?? 0);

  return {
    ...(p as MebleProduct),
    id: String(p.id ?? ''),
    name: String(p.name ?? ''),
    sku: String(p.sku ?? ''),
    ean: String(p.ean ?? ''),
    model: String(p.model ?? ''),
    description: String(p.description ?? ''),
    finalprice,
    regularprice: Number(p.regularprice ?? finalprice),
    qty,
    img: image,
    imgs,
    cats: (p.cats as string[]) || [],
    // compat / normalized
    price_gross: priceGross,
    price_net: priceNet,
    condition: 'new',
    kind: deriveKind(p),
    shipping_cost: shippingCost,
    brand: '',
    gallery_images: galleryImages,
    attrs,
    extra_json: {
      image,
      gallery_images: galleryImages,
      description: String(p.description ?? ''),
      attrs,
      offer_qty: qty,
      ebay_category: {},
    },
  };
}

export interface SearchParams {
  q?: string;
  page?: number;
  perPage?: number;
  filterBy?: string;
  sortBy?: string;
  facetBy?: string;
}

export interface FacetCount { field: string; counts: { value: string; count: number }[]; }

export interface SearchResult {
  hits: MebleProduct[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  facets?: FacetCount[];
}

export async function searchProducts(
  collection: string,
  params: SearchParams = {}
): Promise<SearchResult> {
  const client = getTypesenseClient();
  const { q = '*', page = 1, perPage = 20, filterBy, sortBy, facetBy } = params;

  const searchParams: Record<string, unknown> = {
    q,
    query_by: 'name,model,sku,ean,subtitle',
    num_typos: '2,1,0,0,2',
    page,
    per_page: perPage,
    // Subset sufficient for the product card + normalization (skip heavy description here).
    include_fields:
      'id,pid,name,subtitle,sku,ean,model,slug,finalprice,regularprice,discountpercent,' +
      'qty,img,imgs,cats,breadcrumbs,shipping_amount,color,warranty,isnew,ispromo,is_set',
  };

  if (filterBy) searchParams.filter_by = filterBy;
  if (sortBy) searchParams.sort_by = sortBy;
  if (facetBy) { searchParams.facet_by = facetBy; searchParams.max_facet_values = 250; }

  // Używamy multi_search (POST) zamiast documents().search() (GET) — filtry typu
  // `id:[...]` z tysiącami ID przekraczają limit długości query string 4000 znaków w GET.
  const multi = await client.multiSearch.perform(
    { searches: [{ collection, ...searchParams } as Record<string, unknown>] } as Parameters<typeof client.multiSearch.perform>[0]
  );
  const result = (multi.results?.[0] ?? {}) as {
    hits?: Array<{ document: Record<string, unknown> }>;
    found?: number;
    facet_counts?: Array<{ field_name: string; counts: { value: string; count: number }[] }>;
  };

  const hits = ((result.hits || []) as Array<{ document: Record<string, unknown> }>).map(
    (hit) => normalizeMebleProduct(hit.document)
  );

  const total = result.found || 0;

  const facets = ((result.facet_counts || []) as Array<{ field_name: string; counts: { value: string; count: number }[] }>)
    .map((f) => ({ field: f.field_name, counts: (f.counts || []).map((c) => ({ value: c.value, count: c.count })) }));

  return {
    hits,
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
    facets,
  };
}

/**
 * Bulk-match Typesense products by an exact field value (e.g. ean or sku), returning a map
 * keyed by that field value. Used to reference marketplace offers back to the base catalog.
 */
export async function matchProductsByField(
  collection: string,
  field: 'ean' | 'sku',
  values: string[]
): Promise<Map<string, MebleProduct>> {
  const client = getTypesenseClient();
  const uniq = Array.from(new Set(values.filter(Boolean)));
  const map = new Map<string, MebleProduct>();
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    const filter = `${field}:=[${chunk.map((v) => '`' + String(v).replace(/`/g, '') + '`').join(',')}]`;
    try {
      const res = await client.collections(collection).documents().search({
        q: '*', query_by: 'name', filter_by: filter, per_page: chunk.length,
      });
      for (const hit of (res.hits || []) as Array<{ document: Record<string, unknown> }>) {
        const key = String(hit.document[field] ?? '');
        if (key) map.set(key, normalizeMebleProduct(hit.document));
      }
    } catch { /* skip chunk on error */ }
  }
  return map;
}

export async function getProduct(
  collection: string,
  id: string
): Promise<MebleProduct | null> {
  try {
    const client = getTypesenseClient();
    const doc = await client
      .collections(collection)
      .documents(id)
      .retrieve();
    return normalizeMebleProduct(doc as Record<string, unknown>);
  } catch {
    return null;
  }
}
