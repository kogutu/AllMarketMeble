import { NextRequest, NextResponse } from 'next/server';
import { syncAll } from '@/lib/marketplaces/sync';
import { listMarketplaces } from '@/lib/marketplaces/catalog';
import logger from '@/lib/logger';

/**
 * GET /api/cron/sync-all
 * Uruchamia pełną synchronizację WSZYSTKICH marketplace'ów równolegle (fire-and-forget).
 * Odpowiedź wraca natychmiast — synchronizacja działa w tle.
 * Zabezpieczony tokenem: nagłówek Authorization: Bearer <CRON_SECRET> LUB ?secret=<CRON_SECRET>
 *
 * Podepnij pod CRON (np. Vercel Cron / cron-job.org):
 *   URL: https://<twoja-domena>/api/cron/sync-all
 *   Header: Authorization: Bearer <CRON_SECRET>
 *   Schedule: 0 *\/2 * * *   (co 2 godziny)
 */
export async function GET(req: NextRequest) {
  // Weryfikacja tokenu
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    const query = req.nextUrl.searchParams.get('secret') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : query;
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const slugs = listMarketplaces().map((m) => m.slug);
  const startedAt = new Date().toISOString();

  // Fire-and-forget — synchronizacje lecą równolegle, odpowiedź wraca od razu
  Promise.all(
    slugs.map((slug) =>
      syncAll(slug)
        .then((r) => logger.info(`cron sync-all: ${slug} done`, { total: r.total }))
        .catch((e) => logger.error(`cron sync-all: ${slug} error`, { err: String(e) }))
    )
  );

  return NextResponse.json({
    ok: true,
    startedAt,
    syncing: slugs,
    message: 'Synchronizacja uruchomiona w tle dla wszystkich marketplace\'ów.',
  });
}
