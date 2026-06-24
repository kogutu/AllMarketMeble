import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value;
  console.log("-------tooo-----");
  console.log(token);
  if (token !== process.env.ADMIN_TOKEN) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!login|_next/static|_next/image|favicon.ico|znaczek.webp|api/auth|api/allegro/callback).*)',
  ],
};
