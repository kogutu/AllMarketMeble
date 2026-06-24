import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizationUrl, listAccounts } from '@/lib/allegro';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const accountId = searchParams.get('accountId') || 'default';
    const accountName = searchParams.get('accountName') || 'Domyslne';

    const accounts = await listAccounts();
    const authUrl = getAuthorizationUrl(accountId, accountName);

    return NextResponse.json({ accounts, authUrl });
  } catch (error) {
    return NextResponse.json(
      { error: 'Auth check failed', details: String(error) },
      { status: 500 }
    );
  }
}
