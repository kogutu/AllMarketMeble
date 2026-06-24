import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/** Fixed/computed columns available in every marketplace grid. */
const CORE = [
  { field: 'base_name', label: 'Produkt' },
  { field: 'base_img', label: 'Zdjęcie' },
  { field: 'ean', label: 'EAN' },
  { field: 'base_price', label: 'Cena bazy' },
  { field: 'market_price', label: 'Cena rynek' },
  { field: 'base_qty', label: 'Ilość bazy' },
  { field: 'market_quantity', label: 'Ilość rynek' },
  { field: 'status', label: 'Status' },
  { field: 'title', label: 'Tytuł oferty' },
  { field: 'base_sku', label: 'SKU bazy' },
  { field: 'base_typesense_id', label: 'ID Typesense' },
  { field: 'ref', label: 'Ref' },
];

/**
 * GET /api/marketplace/fields?slug=…
 * Returns every available column for the view editor: core + ALL keys present in the persisted
 * offer feed (raw_json) for that marketplace — so any property can be added as a column.
 */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug') || 'empik';
  try {
    const rows = await query<{ raw_json: Record<string, unknown> | string | null }>(
      'SELECT raw_json FROM marketplace_live_offers WHERE marketplace = ? AND raw_json IS NOT NULL LIMIT 2000',
      [slug]
    );
    const keys = new Set<string>();
    for (const r of rows) {
      const obj = typeof r.raw_json === 'string' ? (() => { try { return JSON.parse(r.raw_json as string); } catch { return null; } })() : r.raw_json;
      if (obj && typeof obj === 'object') for (const k of Object.keys(obj)) keys.add(k);
    }
    const coreFields = new Set(CORE.map((c) => c.field));
    const dynamic = Array.from(keys).filter((k) => !coreFields.has(k)).sort().map((k) => ({ field: k, label: k }));
    return NextResponse.json({ fields: [...CORE, ...dynamic] });
  } catch (error) {
    return NextResponse.json({ fields: CORE, error: String(error) }, { status: 500 });
  }
}
