import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

/**
 * GET /api/allegro/offer-id?typesense_id=XXX
 * Returns the Allegro offer ID (ref) for a product from marketplace_live_offers.
 * Used by the edit form to find the live offer when allegro_offer_accounts has no entry.
 */
export async function GET(req: NextRequest) {
  const typesense_id = req.nextUrl.searchParams.get('typesense_id');
  if (!typesense_id) return NextResponse.json({ error: 'typesense_id required' }, { status: 400 });

  const row = await queryOne<{ ref: string; account_id: string }>(
    `SELECT ref, account_id FROM marketplace_live_offers
     WHERE marketplace = 'allegro' AND typesense_id = ?
     ORDER BY synced_at DESC LIMIT 1`,
    [typesense_id]
  );

  if (!row) return NextResponse.json({ allegroOfferId: null });
  return NextResponse.json({ allegroOfferId: row.ref, accountId: row.account_id });
}
