import { NextResponse } from 'next/server';
import { getFurnitureLeaves } from '@/lib/allegroCategoryTree';

/** Pełne (cache'owane raz dziennie) drzewo kategorii Meble jako płaska lista liści ze ścieżką. */
export async function GET() {
  try {
    const leaves = await getFurnitureLeaves();
    return NextResponse.json({ leaves });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load category tree', details: String(error) }, { status: 500 });
  }
}
