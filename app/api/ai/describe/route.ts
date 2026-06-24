import { NextRequest, NextResponse } from 'next/server';
import { getProduct } from '@/lib/typesense';
import { generateDescription } from '@/lib/openai';
import { AllegroFormData } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const { productId, collection = 'tyres', formData } = await req.json();

    if (!productId) {
      return NextResponse.json({ error: 'productId is required' }, { status: 400 });
    }

    const product = await getProduct(collection, productId);
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const d: string = await generateDescription(product, formData as Partial<AllegroFormData>);

    let description = d.replace('```html', "");
    description = description.replace("```", "");

    return NextResponse.json({ description });
  } catch (error) {
    return NextResponse.json(
      { error: 'Description generation failed', details: String(error) },
      { status: 500 }
    );
  }
}
