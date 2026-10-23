import { NextRequest, NextResponse } from 'next/server';
import { getProduct } from '@/lib/typesense';
import { fillKauflandForm } from '@/lib/marketplaces/kaufland/ai';
import { KauflandAdapter } from '@/lib/marketplaces/kaufland/adapter';
import type { KauflandAttrSpec } from '@/lib/marketplaces/kaufland/prefill';

/**
 * POST /api/kaufland/fill
 * Body: { productId, categoryCode?, categoryLabel?, collection? }
 *   → { title, handling_time, description, short_description, attributes }
 *
 * `attributes` są kluczowane kodami atrybutów TEJ kategorii — bez `categoryCode` dostaniemy tylko
 * tytuł i opisy, bo nie wiadomo, o jakie pola katalogu pytać.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const productId = String(body?.productId || '');
    const categoryCode = String(body?.categoryCode || '');
    const categoryLabel = String(body?.categoryLabel || '');
    const collection = String(body?.collection || 'meble');
    if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });

    const product = await getProduct(collection, productId);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    let specs: KauflandAttrSpec[] = [];
    if (categoryCode) {
      const adapter = await KauflandAdapter.create('kaufland');
      specs = (await adapter.getCategoryAttributes(categoryCode).catch(() => [])) as KauflandAttrSpec[];
    }

    const result = await fillKauflandForm(product, categoryLabel, specs);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'fill failed', details: String(error) }, { status: 500 });
  }
}
