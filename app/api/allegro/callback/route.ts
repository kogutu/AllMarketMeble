import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForToken, parseOAuthState } from '@/lib/allegro';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state') || '';

  if (error) {
    return NextResponse.redirect(
      new URL(`/accounts?allegro_error=${encodeURIComponent(error)}`, req.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/accounts?allegro_error=no_code', req.url)
    );
  }

  try {
    const parsed = parseOAuthState(state);
    const accountId = parsed?.accountId || 'default';
    const accountName = parsed?.accountName || 'Konto';
    await exchangeCodeForToken(code, accountId, accountName);
    return NextResponse.redirect(
      new URL(`/accounts?allegro_success=${encodeURIComponent(accountName)}`, req.url)
    );
  } catch (err) {
    console.error('Token exchange error:', err);
    return NextResponse.redirect(
      new URL(`/accounts?allegro_error=${encodeURIComponent(String(err))}`, req.url)
    );
  }
}
