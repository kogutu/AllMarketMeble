import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getProduct, matchProductsByField } from '@/lib/typesense';
import { getAdapterBySlug } from '@/lib/marketplaces/registry';
import { getMarketplace } from '@/lib/marketplaces/catalog';
import { listAccountOffers, updateOfferPriceStock } from '@/lib/allegro';
import type { LiveOffersAdapter } from '@/lib/marketplaces/types';
import type { MebleProduct } from '@/types';

/** Back-compat: old callers passed engine ('mirakl'); map to a slug. */
function resolveSlug(sp: URLSearchParams): string {
  const slug = sp.get('slug');
  if (slug) return slug;
  const mp = sp.get('marketplace');
  return mp === 'mirakl' ? 'empik' : (mp || 'empik');
}

interface CompareItem {
  ref: string;
  ean: string | null;
  marketplace: string;
  title: string | null;
  state: string;
  market: { price: number | null; quantity: number | null };
  base: { typesense_id: string; name: string; img: string; sku: string; ean: string; price: number | null; qty: number | null } | null;
  meta?: { ean?: string | null; stateCode?: string; leadtime?: number; logisticClass?: string; date?: string | null };
  fields: Record<string, string | number | boolean>;
}

/**
 * Live oferty z API marketplace nie zawierają daty wystawienia/modyfikacji, więc datę bierzemy
 * z naszej bazy publikacji (allegro_offers.updated_at) po `ref` (= allegro_offer_id / shop_sku).
 * Zwraca mapę ref → ISO data modyfikacji.
 */
async function offerDatesByRef(refs: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = Array.from(new Set(refs.filter(Boolean)));
  if (uniq.length === 0) return map;
  const ph = uniq.map(() => '?').join(',');
  const rows = await query<{ ref: string; updated_at: string }>(
    `SELECT oa.allegro_offer_id AS ref, MAX(o.updated_at) AS updated_at
       FROM allegro_offer_accounts oa JOIN allegro_offers o ON o.id = oa.offer_id
      WHERE oa.allegro_offer_id IN (${ph}) GROUP BY oa.allegro_offer_id`,
    uniq
  ).catch(() => []);
  for (const r of rows) if (r.updated_at) map.set(String(r.ref), new Date(r.updated_at).toISOString());
  return map;
}

/** Dopina meta.date (data modyfikacji z naszej bazy) i sortuje najnowsze na górze. */
async function withOfferDates(items: CompareItem[]): Promise<CompareItem[]> {
  const dates = await offerDatesByRef(items.map((i) => i.ref));
  for (const it of items) it.meta = { ...(it.meta || {}), date: dates.get(it.ref) ?? null };
  return items.sort((a, b) => (b.meta?.date || '').localeCompare(a.meta?.date || ''));
}

/** Flatten a marketplace offer into a scalar map (dot keys; arrays joined) for table columns/export. */
function flatten(obj: unknown, prefix = '', out: Record<string, string | number | boolean> = {}, depth = 0): Record<string, string | number | boolean> {
  if (obj == null || depth > 4) return out;
  if (Array.isArray(obj)) {
    if (obj.every((v) => v == null || typeof v !== 'object')) {
      if (obj.length) out[prefix] = obj.filter((v) => v != null).join('; ');
    } else {
      obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out, depth + 1));
    }
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
    }
    return out;
  }
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
    if (prefix) out[prefix] = obj;
  }
  return out;
}

const baseOf = (p: MebleProduct): NonNullable<CompareItem['base']> => ({
  typesense_id: p.id, name: p.name, img: p.img || p.gallery_images?.[0] || '',
  sku: p.sku, ean: p.ean, price: p.price_gross ?? null, qty: p.qty ?? null,
});

/**
 * GET /api/marketplace/offers?marketplace=mirakl|allegro&page=1&perPage=50&accountId=...
 * Source of truth is the MARKETPLACE's live offers (Empik OF21 / Allegro /sale/offers),
 * each referenced back to the Typesense base catalog (by EAN, then SKU).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const slug = resolveSlug(sp);
  const def = getMarketplace(slug);
  if (!def) return NextResponse.json({ error: `Nieznany marketplace: ${slug}`, items: [], total: 0 }, { status: 400 });
  const page = Math.max(1, parseInt(sp.get('page') || '1'));
  const perPage = Math.min(100, Math.max(1, parseInt(sp.get('perPage') || '50')));
  const collection = sp.get('collection') || 'meble';
  const offset = (page - 1) * perPage;

  try {
    if (def.engine !== 'allegro') {
      const adapter = (await getAdapterBySlug(slug)) as unknown as LiveOffersAdapter;
      const { offers, total } = await adapter.listLiveOffers(offset, perPage);

      const byEan = await matchProductsByField(collection, 'ean', offers.map((o) => o.ean || '').filter(Boolean));
      const missing = offers.filter((o) => !(o.ean && byEan.has(o.ean)));
      const bySku = await matchProductsByField(collection, 'sku', missing.map((o) => o.sku).filter(Boolean));

      const items: CompareItem[] = offers.map((o) => {
        const p = (o.ean && byEan.get(o.ean)) || bySku.get(o.sku) || null;
        return {
          ref: o.ref, ean: o.ean, marketplace: slug, title: o.title, state: o.state,
          market: { price: o.price, quantity: o.quantity },
          base: p ? baseOf(p) : null,
          meta: { ean: o.ean, stateCode: o.stateCode, leadtime: o.leadtime, logisticClass: o.logisticClass },
          fields: flatten(o.raw || {}),
        };
      });
      return NextResponse.json({ items: await withOfferDates(items), total, page, perPage });
    }

    // ── Allegro ──────────────────────────────────────────────────────────────
    const accountId = sp.get('accountId') || 'default';
    const { offers, total } = await listAccountOffers(accountId, offset, perPage);

    // Map Allegro offer id → typesense_id. Prefer the EAN-matched synced table, fall back to
    // our local publication records.
    const ids = offers.map((o) => String((o as { id?: string }).id)).filter(Boolean);
    const idToTs = new Map<string, string>();
    const idToEan = new Map<string, string>();
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      const liveRows = await query<{ ref: string; typesense_id: string | null; ean: string | null }>(
        `SELECT ref, typesense_id, ean FROM marketplace_live_offers
         WHERE marketplace = 'allegro' AND ref IN (${ph})`, ids);
      for (const r of liveRows) {
        if (r.typesense_id) idToTs.set(r.ref, r.typesense_id);
        if (r.ean) idToEan.set(r.ref, r.ean);
      }
      const mapRows = await query<{ allegro_offer_id: string; typesense_id: string }>(
        `SELECT allegro_offer_id, typesense_id FROM allegro_offer_accounts
         WHERE allegro_offer_id IN (${ph})`, ids);
      for (const r of mapRows) if (!idToTs.has(r.allegro_offer_id)) idToTs.set(r.allegro_offer_id, r.typesense_id);
    }
    const products = new Map<string, MebleProduct>();
    await Promise.all(Array.from(new Set(idToTs.values())).map(async (tsId) => {
      const p = await getProduct(collection, tsId).catch(() => null);
      if (p) products.set(tsId, p);
    }));

    const items: CompareItem[] = offers.map((raw) => {
      const o = raw as {
        id?: string; name?: string; sellingMode?: { price?: { amount?: string } };
        stock?: { available?: number }; publication?: { status?: string };
      };
      const id = String(o.id);
      const tsId = idToTs.get(id);
      const p = tsId ? products.get(tsId) : null;
      return {
        ref: id, ean: idToEan.get(id) ?? p?.ean ?? null, marketplace: 'allegro', title: o.name ?? null,
        state: o.publication?.status ?? 'unknown',
        market: {
          price: o.sellingMode?.price?.amount != null ? Number(o.sellingMode.price.amount) : null,
          quantity: o.stock?.available ?? null,
        },
        base: p ? baseOf(p) : null,
        fields: flatten(raw),
      };
    });
    return NextResponse.json({ items: await withOfferDates(items), total, page, perPage });
  } catch (error) {
    return NextResponse.json({ error: String(error), items: [], total: 0 }, { status: 500 });
  }
}

/**
 * POST /api/marketplace/offers — update price/quantity of a live offer (by marketplace ref).
 * Body: { marketplace, ref, price, quantity, accountId?, meta? }.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const slug = body?.slug || (body?.marketplace === 'mirakl' ? 'empik' : body?.marketplace) || 'empik';
    const def = getMarketplace(slug);
    if (!def) return NextResponse.json({ error: `Nieznany marketplace: ${slug}` }, { status: 400 });
    const ref = String(body?.ref || '');
    const price = Number(body?.price);
    const quantity = Number(body?.quantity);
    if (!ref || Number.isNaN(price) || Number.isNaN(quantity)) {
      return NextResponse.json({ error: 'ref, price and quantity required' }, { status: 400 });
    }

    if (def.engine !== 'allegro') {
      const adapter = (await getAdapterBySlug(slug)) as unknown as LiveOffersAdapter;
      const meta = body?.meta || {};
      const refOut = await adapter.updateOfferByRef(
        { ref, ean: meta.ean, stateCode: meta.stateCode, leadtime: meta.leadtime, logisticClass: meta.logisticClass },
        price, quantity
      );
      return NextResponse.json({ success: true, marketplace: slug, ref: refOut });
    }

    const accountId = body?.accountId || 'default';
    await updateOfferPriceStock(ref, price, quantity, accountId);
    return NextResponse.json({ success: true, marketplace: slug, ref });
  } catch (error) {
    return NextResponse.json({ error: 'update failed', details: String(error) }, { status: 500 });
  }
}
