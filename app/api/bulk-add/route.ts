import { NextRequest, NextResponse } from 'next/server';
import { enqueue, listQueue, clearQueue, deleteItem, deleteBatch, markPublished, kickWorker, setInternalBase } from '@/lib/bulkAdd';

/** GET /api/bulk-add — stan kolejki „Dodawane". */
export async function GET(req: NextRequest) {
  try {
    setInternalBase(req.nextUrl.origin);
    const items = await listQueue();
    const counts = items.reduce((a, i) => { a[i.status] = (a[i.status] || 0) + 1; return a; }, {} as Record<string, number>);
    if (counts.pending) kickWorker(); // wznów przetwarzanie (np. po restarcie serwera)
    return NextResponse.json({ items, counts });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to list queue', details: String(error), items: [] }, { status: 500 });
  }
}

/**
 * POST /api/bulk-add — dodaj produkty do kolejki obróbki.
 * Body: { productIds: string[], marketplaces: string[], collection?: string }
 */
export async function POST(req: NextRequest) {
  try {
    setInternalBase(req.nextUrl.origin);
    const body = await req.json();
    const productIds: string[] = Array.isArray(body?.productIds) ? body.productIds.map(String) : [];
    const marketplaces: string[] = Array.isArray(body?.marketplaces) ? body.marketplaces.map(String) : [];
    const collection = String(body?.collection || 'meble');
    const name = typeof body?.name === 'string' ? body.name : undefined;
    if (productIds.length === 0 || marketplaces.length === 0) {
      return NextResponse.json({ error: 'productIds and marketplaces required' }, { status: 400 });
    }
    const items = productIds.flatMap((id) => marketplaces.map((m) => ({ typesense_id: id, collection, marketplace: m })));
    const { added, batchId } = await enqueue(items, name);
    kickWorker(); // uruchom przetwarzanie w tle (jeśli nie działa)
    return NextResponse.json({ added, queued: items.length, batchId });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to enqueue', details: String(error) }, { status: 500 });
  }
}

/**
 * DELETE /api/bulk-add
 *   ?id=123        — usuń pojedynczą pozycję
 *   ?batch=<uuid>  — usuń całą nazwaną listę
 *   ?scope=done|all — wyczyść wpisy
 */
export async function DELETE(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const id = sp.get('id');
    const batch = sp.get('batch');
    if (id) await deleteItem(Number(id));
    else if (batch) await deleteBatch(batch);
    else await clearQueue(sp.get('scope') === 'all' ? 'all' : 'done');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete', details: String(error) }, { status: 500 });
  }
}

/** PATCH /api/bulk-add — { id, action:'published' } oznacz pozycję jako wystawioną. */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    if (body?.action === 'published' && body?.id != null) await markPublished(Number(body.id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to patch', details: String(error) }, { status: 500 });
  }
}
