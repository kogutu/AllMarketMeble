import { NextRequest, NextResponse } from 'next/server';
import { getProduct } from '@/lib/typesense';
import { MiraklAdapter } from '@/lib/marketplaces/mirakl/adapter';
import { fillMiraklForm } from '@/lib/marketplaces/mirakl/ai';

/**
 * POST /api/mirakl/fill
 * Body: { productId, operator, accountId?, categoryCode, categoryLabel?, collection? }
 * Loads the category attributes and asks AI to fill title, description and attribute values
 * from the product data. Returns { title, description, attributes }.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const operator = String(body?.operator || '');
    const accountId = String(body?.accountId || operator || 'default');
    const productId = String(body?.productId || '');
    const categoryCode = String(body?.categoryCode || '');
    const categoryLabel = String(body?.categoryLabel || categoryCode);
    const collection = String(body?.collection || 'meble');
    if (!operator || !productId || !categoryCode) {
      return NextResponse.json({ error: 'operator, productId and categoryCode required' }, { status: 400 });
    }

    const product = await getProduct(collection, productId);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const adapter = await MiraklAdapter.create(operator, accountId);
    const attributes = await adapter.getCategoryAttributes(categoryCode);

    const result = await fillMiraklForm(product, categoryLabel, attributes);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'fill failed', details: String(error) }, { status: 500 });
  }
}
