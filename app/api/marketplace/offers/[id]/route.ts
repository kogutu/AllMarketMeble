import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { getAdapter } from '@/lib/marketplaces/registry';
import { MiraklAdapter } from '@/lib/marketplaces/mirakl/adapter';
import { buildAllegroPayload, updateOffer as allegroUpdateOffer } from '@/lib/allegro';
import type { AllegroOffer, MiraklFormData, MarketplaceKind } from '@/types';

/**
 * PATCH /api/marketplace/offers/{id}
 * Body: { price?, quantity? }. Updates the draft and pushes the new price/quantity to the
 * marketplace (Mirakl: OF24 offer import; Allegro: offer update via the existing client).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const offer = await queryOne<AllegroOffer & { marketplace: MarketplaceKind | null; allegro_offer_id: string | null; mirakl_shop_sku: string | null }>(
      'SELECT * FROM allegro_offers WHERE id = ?',
      [params.id]
    );
    if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 });

    const form = (offer.form_data
      ? typeof offer.form_data === 'string' ? JSON.parse(offer.form_data) : offer.form_data
      : {}) as Record<string, unknown>;

    const price = body?.price != null ? Number(body.price) : Number(offer.price ?? (form.price as number) ?? 0);
    const quantity = body?.quantity != null ? Number(body.quantity) : Number(offer.quantity ?? (form.quantity as number) ?? 0);

    const newForm = { ...form, price, quantity };
    await query(
      'UPDATE allegro_offers SET price = ?, quantity = ?, form_data = ?, updated_at = NOW() WHERE id = ?',
      [price, quantity, JSON.stringify(newForm), params.id]
    );

    const marketplace: MarketplaceKind = offer.marketplace || 'allegro';
    const accountId = offer.account_id || (marketplace === 'mirakl' ? 'empik' : 'default');

    if (marketplace === 'mirakl') {
      const adapter = await getAdapter(accountId);
      if (!(adapter instanceof MiraklAdapter)) {
        return NextResponse.json({ error: 'No Mirakl account for this offer' }, { status: 400 });
      }
      const importId = await adapter.pushOffer(newForm as unknown as MiraklFormData, price, quantity);
      await query('UPDATE allegro_offers SET mirakl_offer_import_id = ?, mirakl_state = ?, status = ? WHERE id = ?',
        [importId, 'pending', 'pending', params.id]);
      return NextResponse.json({ success: true, marketplace, importId });
    }

    if (!offer.allegro_offer_id) {
      return NextResponse.json({ error: 'Offer not published on Allegro' }, { status: 400 });
    }
    const payload = await buildAllegroPayload(newForm, accountId);
    await allegroUpdateOffer(offer.allegro_offer_id, payload, accountId);
    return NextResponse.json({ success: true, marketplace, allegroOfferId: offer.allegro_offer_id });
  } catch (error) {
    return NextResponse.json({ error: 'update failed', details: String(error) }, { status: 500 });
  }
}
