import { NextResponse } from 'next/server';
import { listAccounts } from '@/lib/allegro';

export async function GET() {
  try {
    const accounts = await listAccounts();
    return NextResponse.json({ accounts });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
