import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { AllegroOffer } from '@/types';

interface AccountOfferRow {
  offer_id: number;
  account_id: string;
  allegro_offer_id: string | null;
  status: string;
  published_at: string | null;
  marketplace: string | null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = parseInt(searchParams.get('page') || '1');
  const perPage = parseInt(searchParams.get('perPage') || '20');
  const status = searchParams.get('status');
  const typesense_id = searchParams.get('typesense_id');
  const accountId = searchParams.get('account_id');
  const allegroOfferId = searchParams.get('allegro_offer_id');
  const sku = searchParams.get('sku');
  const categoryId = searchParams.get('category_id');
  const offset = (page - 1) * perPage;

  let whereClause = '1=1';
  const params: (string | number | null)[] = [];

  if (status) {
    whereClause += ' AND o.status = ?';
    params.push(status);
  }
  if (typesense_id) {
    whereClause += ' AND o.typesense_id = ?';
    params.push(typesense_id);
  }
  if (sku) {
    whereClause += ' AND (o.typesense_id LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(o.form_data, "$.sku")) LIKE ?)';
    params.push(`%${sku}%`, `%${sku}%`);
  }
  if (accountId) {
    whereClause += ' AND EXISTS (SELECT 1 FROM allegro_offer_accounts oa WHERE oa.offer_id = o.id AND oa.account_id = ?)';
    params.push(accountId);
  }
  if (allegroOfferId) {
    whereClause += ' AND EXISTS (SELECT 1 FROM allegro_offer_accounts oa WHERE oa.offer_id = o.id AND oa.allegro_offer_id LIKE ?)';
    params.push(`%${allegroOfferId}%`);
  }
  if (categoryId) {
    whereClause += ' AND o.category_id = ?';
    params.push(categoryId);
  }

  try {
    const offers = await query<AllegroOffer>(
      `SELECT o.* FROM allegro_offers o WHERE ${whereClause} ORDER BY o.updated_at DESC LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );

    const countResult = await queryOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM allegro_offers o WHERE ${whereClause}`,
      params
    );

    const total = countResult?.total || 0;

    // Fetch per-account publication records for all fetched offers in one query
    let offerAccountsMap: Record<number, AccountOfferRow[]> = {};
    if (offers.length > 0) {
      const offerIds = offers.map((o) => o.id);
      const allAccountOffers = await query<AccountOfferRow>(
        `SELECT offer_id, account_id, allegro_offer_id, status, published_at, marketplace
         FROM allegro_offer_accounts
         WHERE offer_id IN (${offerIds.map(() => '?').join(',')})`,
        offerIds
      );
      for (const row of allAccountOffers) {
        if (!offerAccountsMap[row.offer_id]) offerAccountsMap[row.offer_id] = [];
        offerAccountsMap[row.offer_id].push(row);
      }
    }

    // For single-product query also return flat accountOffers (backwards compat)
    const accountOffers = typesense_id && offers.length > 0
      ? (offerAccountsMap[offers[0].id] || [])
      : [];

    return NextResponse.json({
      offers,
      offerAccountsMap,
      accountOffers,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch offers', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      typesense_id,
      typesense_collection = 'meble',
      marketplace = 'allegro',
      form_data,
      title,
      description,
      price,
      quantity,
      category_id,
    } = body;

    if (!typesense_id) {
      return NextResponse.json({ error: 'typesense_id is required' }, { status: 400 });
    }

    // Check if a draft already exists for this product on this marketplace
    const existing = await queryOne<AllegroOffer>(
      'SELECT id FROM allegro_offers WHERE typesense_id = ? AND marketplace = ? AND status IN ("draft","pending")',
      [typesense_id, marketplace]
    );

    if (existing) {
      // Update existing draft
      await query(
        `UPDATE allegro_offers SET
          form_data = ?,
          title = ?,
          description = ?,
          price = ?,
          quantity = ?,
          category_id = ?,
          updated_at = NOW()
        WHERE id = ?`,
        [
          JSON.stringify(form_data),
          title,
          description,
          price,
          quantity,
          category_id,
          existing.id,
        ]
      );

      const updated = await queryOne<AllegroOffer>(
        'SELECT * FROM allegro_offers WHERE id = ?',
        [existing.id]
      );
      return NextResponse.json(updated);
    }

    const result = await query<{ insertId: number }>(
      `INSERT INTO allegro_offers
        (typesense_id, typesense_collection, marketplace, form_data, title, description, price, quantity, category_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [
        typesense_id,
        typesense_collection,
        marketplace,
        JSON.stringify(form_data),
        title,
        description,
        price,
        quantity,
        category_id,
      ]
    );

    const insertId = (result as unknown as { insertId: number }).insertId;
    const offer = await queryOne<AllegroOffer>(
      'SELECT * FROM allegro_offers WHERE id = ?',
      [insertId]
    );

    return NextResponse.json(offer, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create offer', details: String(error) },
      { status: 500 }
    );
  }
}
