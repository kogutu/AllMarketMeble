import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { listOperators } from '@/lib/marketplaces/mirakl/operators';

interface MiraklAccountRow {
  account_id: string;
  account_name: string;
  operator: string | null;
  base_url: string | null;
  is_active: number;
  created_at: string;
}

/** GET /api/mirakl/accounts → available operators + configured Mirakl accounts (no secrets). */
export async function GET() {
  // Operators come from config, not the DB — always return them (e.g. before the migration runs).
  const operators = listOperators().map((o) => ({ id: o.id, name: o.name }));

  let accounts: MiraklAccountRow[] = [];
  let warning: string | undefined;
  try {
    accounts = await query<MiraklAccountRow>(
      `SELECT account_id, account_name, operator, base_url, is_active, created_at
       FROM allegro_tokens WHERE marketplace = 'mirakl' ORDER BY created_at ASC`
    );
  } catch (error) {
    // Most likely the 'marketplace' column doesn't exist yet — run: npm run db:migrate
    warning = `Nie udało się pobrać kont (uruchom migrację: npm run db:migrate). ${String(error)}`;
  }

  return NextResponse.json({ operators, accounts, warning });
}

/**
 * POST /api/mirakl/accounts — create/update a Mirakl shop account.
 * Body: { accountId, accountName, operator, apiKey, baseUrl? }. Stored in allegro_tokens with
 * marketplace='mirakl'. OAuth-only columns get placeholder values (Mirakl uses an API key).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const accountId = String(body?.accountId || body?.operator || '').trim();
    const operator = String(body?.operator || '').trim();
    const accountName = String(body?.accountName || operator || accountId).trim();
    const apiKey = body?.apiKey ? String(body.apiKey) : null;
    const baseUrl = body?.baseUrl ? String(body.baseUrl) : null;

    if (!accountId || !operator) {
      return NextResponse.json({ error: 'accountId and operator are required' }, { status: 400 });
    }

    await query(
      `INSERT INTO allegro_tokens
         (account_id, account_name, marketplace, operator, api_key, base_url, access_token, expires_at, is_active)
       VALUES (?, ?, 'mirakl', ?, ?, ?, '', '2099-12-31 00:00:00', 1)
       ON DUPLICATE KEY UPDATE
         account_name = VALUES(account_name),
         marketplace = 'mirakl',
         operator = VALUES(operator),
         api_key = COALESCE(VALUES(api_key), api_key),
         base_url = VALUES(base_url),
         updated_at = NOW()`,
      [accountId, accountName, operator, apiKey, baseUrl]
    );

    return NextResponse.json({ success: true, accountId });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** DELETE /api/mirakl/accounts?accountId=... */
export async function DELETE(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('accountId');
  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });
  try {
    await query(`DELETE FROM allegro_tokens WHERE account_id = ? AND marketplace = 'mirakl'`, [accountId]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
