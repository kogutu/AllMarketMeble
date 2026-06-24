import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

interface AccountOfferRow {
  typesense_id: string;
  account_id: string;
  allegro_offer_id: string;
  status: string;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { ids, filter, account } = body;
  let allAccountOffers: any = [];
  if (ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ offers: {} }, { status: 200 });
    }

    const placeholders = ids.map(() => '?').join(',');
    allAccountOffers = await query<AccountOfferRow>(
      `SELECT typesense_id, allegro_offer_id, status, account_id
     FROM allegro_offer_accounts
     WHERE typesense_id IN (${placeholders})`,
      ids
    );
  }


  if (account) {
    console.log(account, filter);

    allAccountOffers = await query<AccountOfferRow>(
      `SELECT typesense_id, allegro_offer_id, status, account_id
     FROM allegro_offer_accounts
     WHERE account_id = '${account}' `
    );
  }

  if (!account && !ids) {
    allAccountOffers = await query<AccountOfferRow>(
      `SELECT typesense_id, allegro_offer_id, status, account_id
     FROM allegro_offer_accounts `
    );
  }



  const res: Record<string, Record<string, { o: string; s: number }>> = {};
  for (const e of allAccountOffers) {
    res[e.typesense_id] ??= {};
    res[e.typesense_id][e.account_id] = {
      o: e.allegro_offer_id,
      s: e.status?.toUpperCase() === 'ACTIVE' ? 1 : 0,
    };
  }

  // Products that have a saved (unpublished) draft in allegro_offers
  let draftRows: { typesense_id: string }[] = [];
  if (ids && Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    draftRows = await query<{ typesense_id: string }>(
      `SELECT DISTINCT typesense_id FROM allegro_offers
       WHERE status = 'draft' AND typesense_id IN (${placeholders})`,
      ids
    );
  } else {
    draftRows = await query<{ typesense_id: string }>(
      `SELECT DISTINCT typesense_id FROM allegro_offers WHERE status = 'draft'`
    );
  }

  const drafts: Record<string, boolean> = {};
  for (const r of draftRows) drafts[r.typesense_id] = true;

  return NextResponse.json({ offers: res, drafts }, { status: 200 });
}
