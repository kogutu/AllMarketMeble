import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { getAdapter } from '@/lib/marketplaces/registry';
import { getProduct } from '@/lib/typesense';
import type { AllegroOffer, TyreProduct } from '@/types';
import logger from '@/lib/logger';

/**
 * Unified publish endpoint covering Allegro and Mirakl (Empik & other operators).
 * The adapter is resolved from the account's marketplace. Allegro keeps its synchronous flow;
 * Mirakl submits async product + offer imports and records the import ids for later sync.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let accountId = 'default';
  let formData: Record<string, unknown> | null = null;

  try {
    const offer = await queryOne<AllegroOffer>('SELECT * FROM allegro_offers WHERE id = ?', [params.id]);
    if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 });

    let bodyFormData: Record<string, unknown> | null = null;
    let basePrice: number | null = null;
    try {
      const body = await req.json();
      if (body?.formData && typeof body.formData === 'object') bodyFormData = body.formData;
      if (body?.accountId) accountId = String(body.accountId);
      if (body?.basePrice != null) basePrice = Number(body.basePrice);
    } catch { /* no body — fall back to DB */ }

    const dbFormData = offer.form_data
      ? typeof offer.form_data === 'string' ? JSON.parse(offer.form_data) : offer.form_data
      : null;
    formData = bodyFormData ?? (dbFormData as Record<string, unknown> | null);
    if (!formData) return NextResponse.json({ error: 'Offer has no form data.' }, { status: 400 });

    if (bodyFormData) {
      await query('UPDATE allegro_offers SET form_data = ? WHERE id = ?', [JSON.stringify(bodyFormData), params.id]);
    }
    await query('UPDATE allegro_offers SET status = "pending", error_message = NULL WHERE id = ?', [params.id]);

    const adapter = await getAdapter(accountId);

    let product: TyreProduct | null = null;
    if (adapter.kind === 'mirakl') {
      product = await getProduct(offer.typesense_collection || 'meble', offer.typesense_id).catch(() => null);
    }

    const outcome = await adapter.publish({ offerId: Number(params.id), product, formData, basePrice });
    logger.debug('marketplace publish outcome', { accountId, kind: adapter.kind, outcome });

    if (outcome.status === 'error') {
      throw new Error(`Publish rejected: ${JSON.stringify(outcome.raw)}`);
    }

    if (adapter.kind === 'mirakl') {
      await query(
        `UPDATE allegro_offers SET
           marketplace = 'mirakl', account_id = ?,
           mirakl_shop_sku = ?, mirakl_product_import_id = ?, mirakl_offer_import_id = ?,
           mirakl_state = 'pending',
           base_price = COALESCE(?, base_price), status = 'pending', updated_at = NOW()
         WHERE id = ?`,
        [accountId, outcome.ref, outcome.productImportId ?? null, outcome.offerImportId ?? null, basePrice, params.id]
      );
    } else if (adapter.kind === 'kaufland') {
      await query(
        `UPDATE allegro_offers SET
           marketplace = 'kaufland', account_id = ?, allegro_offer_id = ?,
           base_price = COALESCE(?, base_price), status = 'active',
           allegro_response = ?, updated_at = NOW()
         WHERE id = ?`,
        [accountId, outcome.ref, basePrice, JSON.stringify({ id: outcome.ref }), params.id]
      );
    } else {
      await query(
        `UPDATE allegro_offers SET
           marketplace = 'allegro', allegro_offer_id = ?, account_id = ?,
           base_price = COALESCE(?, base_price), status = 'active',
           allegro_response = ?, updated_at = NOW()
         WHERE id = ?`,
        [outcome.ref, accountId, basePrice, JSON.stringify({ id: outcome.ref }), params.id]
      );
    }

    await query(
      `INSERT INTO allegro_offer_accounts (offer_id, typesense_id, account_id, marketplace, allegro_offer_id, status, published_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         marketplace = VALUES(marketplace),
         allegro_offer_id = VALUES(allegro_offer_id),
         status = VALUES(status),
         published_at = NOW(),
         updated_at = NOW()`,
      [params.id, offer.typesense_id, accountId, adapter.kind, outcome.ref,
       adapter.kind === 'mirakl' ? 'pending' : 'active']
    );

    return NextResponse.json({ success: true, marketplace: adapter.kind, ref: outcome.ref, outcome });
  } catch (error) {
    console.error('Marketplace publish error:', error);
    await query('UPDATE allegro_offers SET status = "error", error_message = ? WHERE id = ?', [String(error), params.id]);
    try {
      await query(
        `INSERT INTO allegro_publish_errors (account_id, offer_id, error_json, form_data_snapshot) VALUES (?, ?, ?, ?)`,
        [accountId, params.id, String(error), formData ? JSON.stringify(formData) : null]
      );
    } catch { /* non-fatal */ }
    return NextResponse.json({ error: 'Failed to publish offer', details: String(error) }, { status: 500 });
  }
}
