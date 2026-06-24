import { NextRequest, NextResponse } from 'next/server';
import { MiraklAdapter } from '@/lib/marketplaces/mirakl/adapter';

/**
 * GET /api/mirakl/categories/{code}/attributes?operator=empik[&accountId=...]
 * Returns the operator category attributes (with value-list options for LIST types).
 */
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const { searchParams } = req.nextUrl;
  const operator = searchParams.get('operator');
  const accountId = searchParams.get('accountId') || operator || 'default';

  if (!operator) return NextResponse.json({ error: 'operator required' }, { status: 400 });

  try {
    const adapter = await MiraklAdapter.create(operator, accountId);
    const attributes = await adapter.getCategoryAttributes(decodeURIComponent(params.code));
    return NextResponse.json({ attributes });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch attributes', details: String(error) }, { status: 500 });
  }
}
