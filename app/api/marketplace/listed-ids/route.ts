import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/marketplace/listed-ids?slug=empik|brw|kaufland|allegro&active=1
 * Distinct Typesense product ids listed (optionally only active) on the marketplace — used to
 * filter the Products page catalog-wide via Typesense id filters.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const slug = sp.get('slug') || (sp.get('marketplace') === 'mirakl' ? 'empik' : sp.get('marketplace')) || 'empik';
  const activeOnly = sp.get('active') === '1';
  try {
    const rows = await query<{ typesense_id: string }>(
      `SELECT DISTINCT typesense_id FROM marketplace_live_offers
       WHERE marketplace = ? AND typesense_id IS NOT NULL ${activeOnly ? 'AND active = 1' : ''}`,
      [slug]
    );
    return NextResponse.json({ ids: rows.map((r) => r.typesense_id) });
  } catch (error) {
    return NextResponse.json({ ids: [], error: String(error) }, { status: 500 });
  }
}
