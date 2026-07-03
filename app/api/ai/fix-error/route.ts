import { NextRequest, NextResponse } from 'next/server';
import { getProduct } from '@/lib/typesense';
import { fixFormWithAI } from '@/lib/openai';
import { AllegroParamDef } from '@/lib/allegro';

export async function POST(req: NextRequest) {
  try {
    const { productId, collection = process.env.TYPESENSE_COLLECTION_TYRES || 'meble', formData, categoryParams, allegroError } = await req.json();
    if (!productId || !formData || !allegroError) {
      return NextResponse.json({ error: 'productId, formData and allegroError are required' }, { status: 400 });
    }

    const product = await getProduct(collection, productId);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const result = await fixFormWithAI(product, formData, allegroError, (categoryParams as AllegroParamDef[]) || []);
    return NextResponse.json({ formData: result.formData, changes: result.changes, summary: result.summary });
  } catch (error) {
    return NextResponse.json({ error: 'AI fix failed', details: String(error) }, { status: 500 });
  }
}
