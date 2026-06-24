import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import type { AllegroOffer } from '@/types';
import { MiraklClient } from '@/lib/marketplaces/mirakl/client';

/**
 * POST /api/marketplace/added/errors  { id }
 * Fetches live errors for a submitted offer:
 *  - mirakl: product (transformation) + offer import error reports
 *  - allegro/kaufland: the stored error_message (no async import reports)
 * Returns { status, errors: string[] }.
 */
export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const offer = await queryOne<AllegroOffer>('SELECT * FROM allegro_offers WHERE id = ?', [id]);
    if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 });

    const errors: string[] = [];

    if (offer.marketplace === 'mirakl') {
      const operator = offer.account_id === 'brw' ? 'brw' : 'empik';
      const client = await MiraklClient.forOperator(operator, offer.account_id || operator);
      if (offer.mirakl_product_import_id) {
        const pe = await client.getProductImportErrors(offer.mirakl_product_import_id).catch(() => []);
        errors.push(...pe.map((e) => `Produkt: ${e}`));
      }
      if (offer.mirakl_offer_import_id) {
        const oe = await client.getOfferImportErrors(offer.mirakl_offer_import_id).catch(() => []);
        errors.push(...oe.map((e) => `Oferta: ${e}`));
      }
    } else if (offer.error_message) {
      errors.push(offer.error_message);
    }

    return NextResponse.json({ status: offer.status, errors });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch errors', details: String(error) }, { status: 500 });
  }
}
