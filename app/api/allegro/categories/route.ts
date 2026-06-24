import { NextRequest, NextResponse } from 'next/server';
import { getCategories, searchAllegroCategories } from '@/lib/allegro';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const parentId = searchParams.get('parentId') || undefined;
  const phrase = searchParams.get('phrase');

  try {
    if (phrase) {
      const categories = await searchAllegroCategories(phrase);
      return NextResponse.json({ categories });
    }

    const categories = await getCategories(parentId);
    return NextResponse.json({ categories });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch categories', details: String(error) },
      { status: 500 }
    );
  }
}
