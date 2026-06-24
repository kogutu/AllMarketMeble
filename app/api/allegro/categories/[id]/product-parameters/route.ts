import { NextRequest, NextResponse } from 'next/server';
import { getProductParameters } from '@/lib/allegro';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const parameters = await getProductParameters(params.id);
    return NextResponse.json({ parameters });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch product parameters', details: String(error) },
      { status: 500 }
    );
  }
}
