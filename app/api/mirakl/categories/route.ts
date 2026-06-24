import { NextRequest, NextResponse } from 'next/server';
import { MiraklAdapter } from '@/lib/marketplaces/mirakl/adapter';

/**
 * GET /api/mirakl/categories?operator=empik[&accountId=...][&parentCode=...][&phrase=...]
 * Lists (or searches) the operator's category hierarchy. Credentials resolve from the account
 * (if given) or the operator's env vars.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const operator = searchParams.get('operator');
  const accountId = searchParams.get('accountId') || operator || 'default';
  const parentCode = searchParams.get('parentCode') || undefined;
  const phrase = searchParams.get('phrase');

  if (!operator) return NextResponse.json({ error: 'operator required' }, { status: 400 });

  try {
    const adapter = await MiraklAdapter.create(operator, accountId);
    const categories = phrase
      ? await adapter.searchCategories(phrase)
      : await adapter.getCategories(parentCode);
    return NextResponse.json({ categories });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch categories', details: String(error) }, { status: 500 });
  }
}
