import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { createOffer, updateOffer, buildAllegroPayload, getValidToken } from '@/lib/allegro';
import { AllegroOffer } from '@/types';
import logger from '@/lib/logger';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  let accountId = 'default';
  let formData: Record<string, unknown> | null = null;

  try {
    const token = await getValidToken();
    if (!token) {
      return NextResponse.json(
        { error: 'Not authenticated with Allegro. Please authorize first.' },
        { status: 401 }
      );
    }

    const offer = await queryOne<AllegroOffer>(
      'SELECT * FROM allegro_offers WHERE id = ?',
      [params.id]
    );

    if (!offer) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    // Read formData from request body (current UI state takes priority over DB)
    let bodyFormData: Record<string, unknown> | null = null;
    let basePrice: number | null = null;
    try {
      const body = await _req.json();
      if (body?.formData && typeof body.formData === 'object') {
        bodyFormData = body.formData as Record<string, unknown>;
      }
      if (body?.accountId) accountId = String(body.accountId);
      if (body?.basePrice != null) basePrice = Number(body.basePrice);
    } catch {
      // No body or invalid JSON — fall back to DB
    }

    const dbFormData = offer.form_data
      ? (typeof offer.form_data === 'string' ? JSON.parse(offer.form_data) : offer.form_data)
      : null;

    formData = bodyFormData ?? dbFormData;

    if (!formData) {
      return NextResponse.json(
        { error: 'Offer has no form data. Fill the form first.' },
        { status: 400 }
      );
    }

    // If body provided fresh form data, persist it to DB so draft stays in sync
    if (bodyFormData) {
      await query(
        'UPDATE allegro_offers SET form_data = ? WHERE id = ?',
        [JSON.stringify(bodyFormData), params.id]
      );
    }

    // Mark as pending
    await query(
      'UPDATE allegro_offers SET status = "pending", error_message = NULL WHERE id = ?',
      [params.id]
    );

    // Build Allegro payload and create active offer via /sale/product-offers
    const payload = await buildAllegroPayload(formData, accountId);
    logger.debug("alllegro payload publish offer", payload);
    const { id: allegroOfferId } = await createOffer(payload, accountId);

    // Save Allegro offer ID, account, base price and update status
    await query(
      `UPDATE allegro_offers SET
        allegro_offer_id = ?,
        account_id = ?,
        base_price = COALESCE(?, base_price),
        status = 'active',
        allegro_response = ?,
        updated_at = NOW()
      WHERE id = ?`,
      [allegroOfferId, accountId, basePrice, JSON.stringify({ id: allegroOfferId }), params.id]
    );

    // Upsert per-account publication record
    await query(
      `INSERT INTO allegro_offer_accounts (offer_id, typesense_id, account_id, allegro_offer_id, status, published_at)
       VALUES (?, ?, ?, ?, 'active', NOW())
       ON DUPLICATE KEY UPDATE
         allegro_offer_id = VALUES(allegro_offer_id),
         status = 'active',
         published_at = NOW(),
         updated_at = NOW()`,
      [params.id, offer.typesense_id, accountId, allegroOfferId]
    );

    // Optymistycznie oznacz jako WYSTAWIONY (źródło „listed-ids" na stronie Produkty) — produkt
    // podświetla się jako dodany od razu, bez ręcznej synchronizacji ofert.
    const fd = formData as Record<string, unknown>;
    await query(
      `INSERT INTO marketplace_live_offers
         (marketplace, ref, ean, typesense_id, active, price, quantity, title, account_id, raw_json, base_json, meta_json, synced_at)
       VALUES ('allegro', ?, ?, ?, 1, ?, ?, ?, ?, '{}', NULL, '{}', NOW())
       ON DUPLICATE KEY UPDATE
         ean=VALUES(ean), typesense_id=VALUES(typesense_id), active=1,
         price=VALUES(price), quantity=VALUES(quantity), title=VALUES(title),
         account_id=VALUES(account_id), synced_at=NOW()`,
      [
        allegroOfferId, (fd.ean as string) || null, offer.typesense_id,
        basePrice ?? null, fd.quantity != null ? Number(fd.quantity) : null,
        (fd.title as string) || offer.title || null, accountId,
      ]
    ).catch((e) => logger.debug('marketplace_live_offers optimistic upsert failed', { err: String(e) }));

    const accountOffers = await query<{ account_id: string; allegro_offer_id: string; status: string }>(
      'SELECT account_id, allegro_offer_id, status FROM allegro_offer_accounts WHERE offer_id = ?',
      [params.id]
    );

    return NextResponse.json({
      success: true,
      allegroOfferId,
      accountOffers,
    });
  } catch (error) {
    console.error('Publish error:', error);

    await query(
      'UPDATE allegro_offers SET status = "error", error_message = ? WHERE id = ?',
      [String(error), params.id]
    );

    // Log to error table for the errors page
    try {
      await query(
        `INSERT INTO allegro_publish_errors (account_id, offer_id, error_json, form_data_snapshot)
         VALUES (?, ?, ?, ?)`,
        [accountId, params.id, String(error), formData ? JSON.stringify(formData) : null]
      );
    } catch { /* logging failure is non-fatal */ }

    return NextResponse.json(
      { error: 'Failed to publish offer', details: String(error) },
      { status: 500 }
    );
  }
}

// ── PATCH: edit an already-published offer on Allegro ────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let accountId = 'default';
  try {
    const body = await req.json();
    if (body?.accountId) accountId = String(body.accountId);

    const formData: Record<string, unknown> = body?.formData ?? {};

    // Look up the allegro_offer_id for this account from DB
    const row = await queryOne<{ allegro_offer_id: string }>(
      `SELECT allegro_offer_id FROM allegro_offer_accounts
       WHERE offer_id = ? AND account_id = ? AND allegro_offer_id IS NOT NULL
       LIMIT 1`,
      [params.id, accountId]
    );

    if (!row?.allegro_offer_id) {
      return NextResponse.json(
        { error: `Brak opublikowanej oferty dla konta ${accountId}` },
        { status: 404 }
      );
    }

    const allegroOfferId = row.allegro_offer_id;

    // Persist updated form_data to DB
    await query(
      'UPDATE allegro_offers SET form_data = ?, updated_at = NOW() WHERE id = ?',
      [JSON.stringify(formData), params.id]
    );

    const payload = await buildAllegroPayload(formData, accountId);
    logger.debug('allegro payload edit offer', payload);
    await updateOffer(allegroOfferId, payload, accountId);

    return NextResponse.json({ success: true, allegroOfferId });
  } catch (error) {
    console.error('Edit offer error:', error);
    return NextResponse.json(
      { error: 'Błąd edycji oferty', details: String(error) },
      { status: 500 }
    );
  }
}
