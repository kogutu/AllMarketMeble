import { NextRequest, NextResponse } from 'next/server';
import { getAllShippingRates } from '@/lib/allegro';

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('accountId') || 'default';
  try {
    const rates = await getAllShippingRates(accountId);
    return NextResponse.json({ rates });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
