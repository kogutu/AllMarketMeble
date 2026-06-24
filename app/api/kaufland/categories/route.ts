import { NextRequest, NextResponse } from 'next/server';
import { KauflandAdapter } from '@/lib/marketplaces/kaufland/adapter';

/**
 * GET /api/kaufland/categories[?parentCode=...][&phrase=...]
 * Lists Kaufland categories (children of parent, or root) or searches leaf categories by phrase.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const parentCode = searchParams.get('parentCode') || undefined;
  const phrase = searchParams.get('phrase');
  try {
    const adapter = await KauflandAdapter.create('kaufland');
    const categories = phrase
      ? await adapter.searchCategories(phrase)
      : await adapter.getCategories(parentCode);
    return NextResponse.json({ categories });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch categories', details: String(error) }, { status: 500 });
  }
}
