import { NextRequest, NextResponse } from 'next/server';
import { syncChunk, cleanupSync, lastSync } from '@/lib/marketplaces/sync';

function resolveSlug(sp: URLSearchParams): string {
  const slug = sp.get('slug');
  if (slug) return slug;
  const mp = sp.get('marketplace');
  return mp === 'mirakl' ? 'empik' : (mp || 'empik');
}

/** GET → last sync time for a marketplace slug. */
export async function GET(req: NextRequest) {
  const slug = resolveSlug(req.nextUrl.searchParams);
  return NextResponse.json({ lastSync: await lastSync(slug) });
}

/**
 * POST chunked sync (client-driven). Params: slug, offset, limit, runStartedAt, accountId, cleanup.
 * Persists full offer payload to DB and updates sync_jobs progress.
 */
export async function POST(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const slug = resolveSlug(sp);
  const runStartedAt = sp.get('runStartedAt') || String(Date.now());
  try {
    if (sp.get('cleanup') === '1') {
      await cleanupSync(slug, runStartedAt);
      return NextResponse.json({ cleaned: true });
    }
    const offset = parseInt(sp.get('offset') || '0');
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '50')));
    const accountId = sp.get('accountId') || undefined;
    const r = await syncChunk(slug, offset, limit, runStartedAt, accountId);
    return NextResponse.json(r);
  } catch (error) {
    return NextResponse.json({ error: 'sync failed', details: String(error) }, { status: 500 });
  }
}
