import { NextRequest, NextResponse } from 'next/server';
import { getProduct } from '@/lib/typesense';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const collection =
    req.nextUrl.searchParams.get('collection') ||
    process.env.TYPESENSE_COLLECTION_TYRES ||
    'meble';

  try {
    const product = await getProduct(collection, params.id);
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    return NextResponse.json(product);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch product', details: String(error) },
      { status: 500 }
    );
  }
}
