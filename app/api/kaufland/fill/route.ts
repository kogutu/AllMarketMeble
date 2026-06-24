import { NextRequest, NextResponse } from 'next/server';
import { getProduct } from '@/lib/typesense';
import { fillKauflandForm } from '@/lib/marketplaces/kaufland/ai';

/**
 * POST /api/kaufland/fill
 * Body: { productId, categoryLabel?, collection? } → { title, handling_time }
 * Kaufland has no per-category attributes; AI only proposes a clean offer note + handling time.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const productId = String(body?.productId || '');
    const categoryLabel = String(body?.categoryLabel || '');
    const collection = String(body?.collection || 'meble');
    if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });

    const product = await getProduct(collection, productId);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const result = await fillKauflandForm(product, categoryLabel);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'fill failed', details: String(error) }, { status: 500 });
  }
}
