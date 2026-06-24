import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

interface DbRow {
  ref: string; ean: string | null; title: string | null; active: number;
  price: number | null; quantity: number | null;
  raw_json: Record<string, unknown> | string | null;
  base_json: Record<string, unknown> | string | null;
  meta_json: Record<string, unknown> | string | null;
}
const parse = (v: unknown) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);

function resolveSlug(sp: URLSearchParams): string {
  const slug = sp.get('slug');
  if (slug) return slug;
  const mp = sp.get('marketplace');
  return mp === 'mirakl' ? 'empik' : (mp || 'empik');
}

/**
 * GET /api/marketplace/offers-db?slug=…  — persisted offers (no marketplace/Typesense calls).
 * Source for the grid so opening the page does NOT hit the marketplace API.
 */
export async function GET(req: NextRequest) {
  const slug = resolveSlug(req.nextUrl.searchParams);
  try {
    const rows = await query<DbRow>(
      `SELECT ref, ean, title, active, price, quantity, raw_json, base_json, meta_json
       FROM marketplace_live_offers WHERE marketplace = ? ORDER BY id ASC`, [slug]
    );
    const items = rows.map((r) => ({
      ref: r.ref, ean: r.ean, title: r.title,
      state: r.active ? 'active' : 'inactive',
      market: { price: r.price != null ? Number(r.price) : null, quantity: r.quantity ?? null },
      base: parse(r.base_json),
      meta: parse(r.meta_json) || {},
      fields: parse(r.raw_json) || {},
    }));
    return NextResponse.json({ items, total: items.length });
  } catch (error) {
    return NextResponse.json({ error: String(error), items: [], total: 0 }, { status: 500 });
  }
}
