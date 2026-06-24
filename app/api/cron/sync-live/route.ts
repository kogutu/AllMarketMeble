import { NextRequest, NextResponse } from 'next/server';
import { syncAll } from '@/lib/marketplaces/sync';
import { listMarketplaces, getMarketplace } from '@/lib/marketplaces/catalog';

export const maxDuration = 300; // allow long runs where the platform supports it

/**
 * CRON / manual full sync of marketplace offers into the DB.
 * GET or POST /api/cron/sync-live?slug=all|empik|brw|kaufland|allegro[&secret=…]
 * Progress is written to sync_jobs (poll /api/marketplace/sync-status).
 */
async function handle(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const secret = process.env.CRON_SECRET;
  if (secret && sp.get('secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const slug = sp.get('slug') || 'all';
  const targets = slug === 'all' ? listMarketplaces().map((m) => m.slug) : (getMarketplace(slug) ? [slug] : []);
  if (targets.length === 0) return NextResponse.json({ error: `Nieznany marketplace: ${slug}` }, { status: 400 });

  // Marketplaces sync in parallel (each writes its own sync_jobs row).
  const results: Record<string, { total?: number; error?: string }> = {};
  await Promise.all(targets.map(async (s) => {
    try { results[s] = await syncAll(s); }
    catch (e) { results[s] = { error: String(e) }; }
  }));
  return NextResponse.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
