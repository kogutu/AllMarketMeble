import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getLiveOffer } from '@/lib/allegro';

interface OfferAccountRow {
  id: number;
  offer_id: number;
  account_id: string;
  allegro_offer_id: string | null;
  status: string;
  allegro_title: string | null;
  published_at: string | null;
  last_sync: string | null;
}

/** GET /api/allegro/offer-accounts?typesense_id=X[&sync=1] */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const typesenseId = searchParams.get('typesense_id');
  const offerId = searchParams.get('offer_id');
  const doSync = searchParams.get('sync') === '1';

  if (!typesenseId && !offerId) {
    return NextResponse.json({ error: 'typesense_id or offer_id required' }, { status: 400 });
  }

  try {
    const rows = await query<OfferAccountRow>(
      offerId
        ? 'SELECT * FROM allegro_offer_accounts WHERE offer_id = ?'
        : 'SELECT * FROM allegro_offer_accounts WHERE typesense_id = ?',
      [offerId ?? typesenseId]
    );

    if (!doSync || rows.length === 0) {
      return NextResponse.json({ accounts: rows });
    }

    // Fetch live status from Allegro for each row that has an allegro_offer_id
    const syncResults = await Promise.allSettled(
      rows
        .filter((r) => r.allegro_offer_id)
        .map(async (r) => {
          try {
            const live = await getLiveOffer(r.allegro_offer_id!, r.account_id);
            const status = (live as { publication?: { status?: string } }).publication?.status ?? r.status;
            const title = (live as { name?: string }).name ?? r.allegro_title;
            await query(
              `UPDATE allegro_offer_accounts SET status = ?, allegro_title = ?, last_sync = NOW() WHERE id = ?`,
              [status, title, r.id]
            );
            return { id: r.id, status, allegro_title: title };
          } catch {
            return { id: r.id, status: r.status };
          }
        })
    );

    // Reload after sync
    const updated = await query<OfferAccountRow>(
      offerId
        ? 'SELECT * FROM allegro_offer_accounts WHERE offer_id = ?'
        : 'SELECT * FROM allegro_offer_accounts WHERE typesense_id = ?',
      [offerId ?? typesenseId]
    );

    return NextResponse.json({ accounts: updated, syncResults: syncResults.length });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
