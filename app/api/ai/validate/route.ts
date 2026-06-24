import { NextRequest, NextResponse } from 'next/server';
import { getProduct } from '@/lib/typesense';
import { validateFormData } from '@/lib/openai';
import { AllegroFormData } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const { productId, collection = 'tyres', formData, categoryParams } = await req.json();

    if (!productId || !formData) {
      return NextResponse.json(
        { error: 'productId and formData are required' },
        { status: 400 }
      );
    }

    const product = await getProduct(collection, productId);
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const result = await validateFormData(formData as Partial<AllegroFormData>, product, categoryParams);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: 'Validation failed', details: String(error) },
      { status: 500 }
    );
  }
}
