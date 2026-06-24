import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getMarketplace } from '@/lib/marketplaces/catalog';
import { MiraklAdapter } from '@/lib/marketplaces/mirakl/adapter';
import { KauflandAdapter } from '@/lib/marketplaces/kaufland/adapter';
import { AllegroAdapter } from '@/lib/marketplaces/allegro/adapter';

/**
 * Withdraw (remove) a live offer from a marketplace.
 * Body: { slug, ref, accountId?, meta? }
 *  - mirakl (empik/brw): ref = shop_sku → OF24 import with update_delete=delete
 *  - allegro: ref = allegro_offer_id → publication command action END
 *  - kaufland: ref = id_unit → DELETE /units/{id}
 * `slug` may be a marketplace slug (allegro|empik|brw|kaufland) or a Mirakl operator id.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const slug = String(body?.slug || '').trim();
    const ref = String(body?.ref || '').trim();
    const accountId = body?.accountId ? String(body.accountId) : undefined;
    if (!slug || !ref) {
      return NextResponse.json({ error: 'slug and ref are required' }, { status: 400 });
    }

    // Resolve engine: catalog slug first, then treat slug as a Mirakl operator id.
    const def = getMarketplace(slug);
    const engine = def?.engine ?? (slug === 'empik' || slug === 'brw' ? 'mirakl' : undefined);

    let result: string;
    if (engine === 'mirakl') {
      const operator = def?.operator ?? slug;
      const adapter = await MiraklAdapter.create(operator, accountId || operator);
      result = await adapter.withdraw(ref);
    } else if (engine === 'kaufland') {
      const adapter = await KauflandAdapter.create('kaufland');
      result = await adapter.withdraw(ref);
    } else if (engine === 'allegro' || slug === 'allegro') {
      const adapter = new AllegroAdapter(accountId || 'default');
      result = await adapter.withdraw(ref);
    } else {
      return NextResponse.json({ error: `Unknown marketplace: ${slug}` }, { status: 400 });
    }

    // Best-effort: mark local publication records as ended (non-fatal).
    try {
      await query(
        `UPDATE allegro_offer_accounts SET status = 'ended', updated_at = NOW()
         WHERE allegro_offer_id = ? OR (account_id = ? AND allegro_offer_id IS NULL)`,
        [ref, accountId ?? '']
      );
    } catch { /* ignore */ }

    return NextResponse.json({ success: true, ref: result });
  } catch (error) {
    console.error('Marketplace withdraw error:', error);
    return NextResponse.json({ error: 'Failed to withdraw offer', details: String(error) }, { status: 500 });
  }
}
