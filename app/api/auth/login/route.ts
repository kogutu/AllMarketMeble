import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { user, password } = await req.json() as { user: string; password: string };

  if (user !== process.env.ADMIN_USER || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('auth_token', process.env.ADMIN_TOKEN!, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
