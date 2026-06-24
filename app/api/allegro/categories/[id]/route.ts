import { NextRequest, NextResponse } from 'next/server';
import { getCategoryById, getCategoryParameters } from '@/lib/allegro';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { searchParams } = req.nextUrl;
  const includeParams = searchParams.get('parameters') === 'true';

  try {
    const category = await getCategoryById(params.id);

    if (includeParams) {
      const parameters = await getCategoryParameters(params.id);
      return NextResponse.json({ category, parameters });
    }

    return NextResponse.json({ category });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch category', details: String(error) },
      { status: 500 }
    );
  }
}
