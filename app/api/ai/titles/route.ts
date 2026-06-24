import { NextRequest, NextResponse } from 'next/server';
import { getProduct } from '@/lib/typesense';
import { generateAccountTitles } from '@/lib/openai';

export async function POST(req: NextRequest) {
  try {
    const { productId, collection = 'tyres', baseTitle, accounts } = await req.json();

    if (!productId || !baseTitle || !Array.isArray(accounts)) {
      return NextResponse.json({ error: 'productId, baseTitle and accounts are required' }, { status: 400 });
    }

    const product = await getProduct(collection, productId);
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const titles = await generateAccountTitles(baseTitle, product, accounts);

    return NextResponse.json({ titles });
  } catch (error) {
    return NextResponse.json(
      { error: 'Title generation failed', details: String(error) },
      { status: 500 }
    );
  }
}
