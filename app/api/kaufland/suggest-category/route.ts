import { NextRequest, NextResponse } from 'next/server';
import { getProduct } from '@/lib/typesense';
import { KauflandAdapter } from '@/lib/marketplaces/kaufland/adapter';
import { suggestKauflandCategory } from '@/lib/marketplaces/kaufland/ai';

/**
 * POST /api/kaufland/suggest-category
 * Body: { productId, collection? } → { categoryCode, categoryLabel } | {}
 * Heuristic: search leaf categories by product name tokens, then let AI pick the best.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const productId = String(body?.productId || '');
    const collection = String(body?.collection || 'meble');
    if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });

    const product = await getProduct(collection, productId);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const adapter = await KauflandAdapter.create('kaufland');

    // Collect candidates from a few phrases (name words + kind).
    const phrases = [product.kind, ...(product.name || '').split(/\s+/).slice(0, 3)].filter(Boolean) as string[];
    const seen = new Set<string>();
    const candidates = [] as Awaited<ReturnType<typeof adapter.searchCategories>>;
    for (const ph of phrases) {
      const res = await adapter.searchCategories(ph).catch(() => []);
      for (const c of res) if (!seen.has(c.code)) { seen.add(c.code); candidates.push(c); }
      if (candidates.length >= 40) break;
    }
    if (candidates.length === 0) return NextResponse.json({});

    const pick = await suggestKauflandCategory(product, candidates);
    if (!pick) return NextResponse.json({});
    return NextResponse.json({ categoryCode: pick.code, categoryLabel: pick.label });
  } catch (error) {
    return NextResponse.json({ error: 'suggest failed', details: String(error) }, { status: 500 });
  }
}
