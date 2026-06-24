import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import type { AllegroOffer } from '@/types';
import { getMarketplace } from '@/lib/marketplaces/catalog';

/**
 * GET /api/marketplace/added
 * Lists offers that were submitted to a marketplace (status != draft), with per-marketplace status
 * and any stored error. Mirakl import ids are returned so the UI can fetch live import errors.
 */
export interface AddedRow {
  id: number;
  market: string;          // display name (Empik / BRW / Allegro / Kaufland)
  slug: string;            // allegro | empik | brw | kaufland
  engine: string;          // allegro | mirakl | kaufland
  sku: string;
  ean: string;
  status: string;
  ref: string | null;      // allegro_offer_id / shop_sku / unit id
  error: string | null;    // stored error_message
  productImportId: string | null;
  offerImportId: string | null;
  accountId: string | null;
  updatedAt: string;
}

function marketName(engine: string, accountId: string | null): { name: string; slug: string } {
  if (engine === 'mirakl') {
    const slug = accountId === 'brw' ? 'brw' : 'empik';
    return { name: getMarketplace(slug)?.name ?? slug, slug };
  }
  if (engine === 'kaufland') return { name: 'Kaufland', slug: 'kaufland' };
  return { name: 'Allegro', slug: 'allegro' };
}

export async function GET() {
  try {
    const offers = await query<AllegroOffer>(
      `SELECT * FROM allegro_offers WHERE status <> 'draft' ORDER BY updated_at DESC LIMIT 2000`
    );

    const rows: AddedRow[] = offers.map((o) => {
      const fd = (typeof o.form_data === 'string' ? safeParse(o.form_data) : o.form_data) as
        Record<string, unknown> | null;
      const sku = String((fd?.sku as string) || o.mirakl_shop_sku || o.typesense_id || '');
      const ean = String((fd?.ean as string) || '');
      const { name, slug } = marketName(o.marketplace, o.account_id);
      return {
        id: o.id,
        market: name,
        slug,
        engine: o.marketplace,
        sku,
        ean,
        status: o.status,
        ref: o.allegro_offer_id ?? o.mirakl_shop_sku ?? null,
        error: o.error_message ?? null,
        productImportId: o.mirakl_product_import_id ?? null,
        offerImportId: o.mirakl_offer_import_id ?? null,
        accountId: o.account_id ?? null,
        updatedAt: o.updated_at,
      };
    });

    return NextResponse.json({ rows });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to list added offers', details: String(error) }, { status: 500 });
  }
}

function safeParse(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s); } catch { return null; }
}
