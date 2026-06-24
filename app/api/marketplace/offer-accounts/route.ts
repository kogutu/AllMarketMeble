import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { getAdapter } from '@/lib/marketplaces/registry';

interface OfferAccountRow {
  id: number;
  offer_id: number;
  account_id: string;
  marketplace: string;
  allegro_offer_id: string | null;
  status: string;
  allegro_title: string | null;
  published_at: string | null;
  last_sync: string | null;
}

/**
 * GET /api/marketplace/offer-accounts?typesense_id=X|offer_id=Y[&sync=1]
 * Returns per-account publication rows; with sync=1, refreshes live/import status via the
 * marketplace adapter (Allegro live offer, Mirakl product/offer import tracking).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const typesenseId = searchParams.get('typesense_id');
  const offerId = searchParams.get('offer_id');
  const doSync = searchParams.get('sync') === '1';

  if (!typesenseId && !offerId) {
    return NextResponse.json({ error: 'typesense_id or offer_id required' }, { status: 400 });
  }

  const whereSql = offerId
    ? 'SELECT * FROM allegro_offer_accounts WHERE offer_id = ?'
    : 'SELECT * FROM allegro_offer_accounts WHERE typesense_id = ?';
  const whereVal = offerId ?? typesenseId;

  try {
    const rows = await query<OfferAccountRow>(whereSql, [whereVal]);
    if (!doSync || rows.length === 0) return NextResponse.json({ accounts: rows });

    await Promise.allSettled(
      rows
        .filter((r) => r.allegro_offer_id)
        .map(async (r) => {
          const adapter = await getAdapter(r.account_id);
          let extra: { productImportId?: string; offerImportId?: string } | undefined;
          if (adapter.kind === 'mirakl') {
            const ids = await queryOne<{ mirakl_product_import_id: string | null; mirakl_offer_import_id: string | null }>(
              'SELECT mirakl_product_import_id, mirakl_offer_import_id FROM allegro_offers WHERE id = ?',
              [r.offer_id]
            );
            extra = {
              productImportId: ids?.mirakl_product_import_id ?? undefined,
              offerImportId: ids?.mirakl_offer_import_id ?? undefined,
            };
          }
          const live = await adapter.syncStatus(r.allegro_offer_id!, extra);
          await query(
            `UPDATE allegro_offer_accounts SET status = ?, allegro_title = ?, last_sync = NOW() WHERE id = ?`,
            [live.status, live.title ?? r.allegro_title, r.id]
          );
          if (adapter.kind === 'mirakl') {
            await query('UPDATE allegro_offers SET mirakl_state = ?, status = ? WHERE id = ?',
              [live.status, live.status === 'active' ? 'active' : live.status === 'error' ? 'error' : 'pending', r.offer_id]);
          }
        })
    );

    const updated = await query<OfferAccountRow>(whereSql, [whereVal]);
    return NextResponse.json({ accounts: updated });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
