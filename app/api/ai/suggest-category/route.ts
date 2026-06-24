import { NextRequest, NextResponse } from 'next/server';
import { getProduct } from '@/lib/typesense';
import { searchAllegroCategories } from '@/lib/allegro';
import { suggestCategoryWithAI, AllegroCategory } from '@/lib/openai';

export async function POST(req: NextRequest) {
  try {
    const { productId, collection = 'tyres' } = await req.json();
    if (!productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 });

    const product = await getProduct(collection, productId);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    // Build search phrase from product data
    const kind = product.kind || 'mebel';
    const phrase = `${kind} ${product.name}`.trim();

    const raw = await searchAllegroCategories(phrase);
    const candidates: AllegroCategory[] = (raw as { id: string; name: string; leaf?: boolean }[]).map((c) => ({
      id: c.id,
      name: c.name,
      leaf: c.leaf,
    }));

    const result = await suggestCategoryWithAI(product, candidates);
    if (!result) return NextResponse.json({ error: 'Could not suggest category' }, { status: 422 });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Suggest category failed', details: String(error) }, { status: 500 });
  }
}
