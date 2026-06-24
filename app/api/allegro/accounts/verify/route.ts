import { NextResponse } from 'next/server';
import { listAccounts, verifyToken } from '@/lib/allegro';

export async function GET() {
  try {
    const accounts = await listAccounts();
    const results = await Promise.all(
      accounts.map(async (acc) => ({
        account_id: acc.account_id,
        ok: await verifyToken(acc.account_id),
      }))
    );
    const verified: Record<string, boolean> = {};
    for (const r of results) verified[r.account_id] = r.ok;
    return NextResponse.json({ verified });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
