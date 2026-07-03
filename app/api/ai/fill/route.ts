import { NextRequest, NextResponse } from 'next/server';
import { getProduct } from '@/lib/typesense';
import { fillFormWithAI } from '@/lib/openai';
import { AllegroParamDef } from '@/lib/allegro';

export async function POST(req: NextRequest) {
  try {
    const { productId, collection = process.env.TYPESENSE_COLLECTION_TYRES || 'meble', categoryId, categoryName, categoryParams } = await req.json();

    if (!productId) {
      return NextResponse.json({ error: 'productId is required' }, { status: 400 });
    }

    const product = await getProduct(collection, productId);
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const formData = await fillFormWithAI(
      product,
      categoryId as string | undefined,
      categoryName as string | undefined,
      (categoryParams as AllegroParamDef[]) || []
    );
    return NextResponse.json({ formData });
  } catch (error) {
    return NextResponse.json(
      { error: 'AI fill failed', details: String(error) },
      { status: 500 }
    );
  }
}
