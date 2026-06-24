import { NextRequest, NextResponse } from 'next/server';
import { deleteAccount, isAuthenticated } from '@/lib/allegro';
import { query } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ok = await isAuthenticated(params.id);
    return NextResponse.json({ authenticated: ok });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await _req.json().catch(() => ({})) as {
      setDefault?: boolean;
      is_active?: boolean;
      account_name?: string;
    };

    if (body.setDefault) {
      await query('UPDATE allegro_tokens SET is_default = 0');
      await query('UPDATE allegro_tokens SET is_default = 1 WHERE account_id = ?', [params.id]);
    }
    if (typeof body.is_active === 'boolean') {
      await query('UPDATE allegro_tokens SET is_active = ? WHERE account_id = ?', [body.is_active ? 1 : 0, params.id]);
    }
    if (body.account_name !== undefined) {
      await query('UPDATE allegro_tokens SET account_name = ? WHERE account_id = ?', [body.account_name.trim(), params.id]);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await deleteAccount(params.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
