import { NextRequest, NextResponse } from 'next/server';
import { kickWorker, listQueue, setInternalBase } from '@/lib/bulkAdd';

export const maxDuration = 300;

/**
 * CRON / ręczne wznowienie przetwarzania kolejki BULK („Dodawane").
 * GET|POST /api/cron/bulk-process[?secret=…]
 *
 * Podstawowo obróbka rusza automatycznie in-process zaraz po dodaniu do kolejki; ten endpoint to
 * SIATKA BEZPIECZEŃSTWA — zewnętrzny harmonogram może go wywoływać, by wznowić kolejkę np. po
 * restarcie serwera.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.nextUrl.searchParams.get('secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  setInternalBase(req.nextUrl.origin);
  const items = await listQueue();
  const pending = items.filter((i) => i.status === 'pending' || i.status === 'processing').length;
  if (pending > 0) kickWorker();
  return NextResponse.json({ ok: true, pending, kicked: pending > 0 });
}

export const GET = handle;
export const POST = handle;
