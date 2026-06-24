import { NextRequest, NextResponse } from 'next/server';
import { getAccountInfo } from '@/lib/allegro';

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('accountId') || 'default';
  try {
    const info = await getAccountInfo(accountId);
    return NextResponse.json(info);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
