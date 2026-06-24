import { NextRequest, NextResponse } from 'next/server';
import { searchProducts } from '@/lib/typesense';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const q = searchParams.get('q') || '*';
  const page = parseInt(searchParams.get('page') || '1');
  const perPage = parseInt(searchParams.get('perPage') || '20');
  const collection = searchParams.get('collection') || process.env.TYPESENSE_COLLECTION_TYRES || 'meble';
  const filterBy = searchParams.get('filterBy') || undefined;
  const sortBy = searchParams.get('sortBy') || undefined;
  const facetBy = searchParams.get('facetBy') || undefined;

  try {
    const result = await searchProducts(collection, {
      q,
      page,
      perPage,
      filterBy,
      sortBy,
      facetBy,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Typesense search error:', error);
    return NextResponse.json(
      { error: 'Failed to search products', details: String(error) },
      { status: 500 }
    );
  }
}
