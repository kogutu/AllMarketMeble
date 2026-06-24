import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export interface MarginRule {
  id: number;
  account_id: string;
  category_source: 'all' | 'typesense' | 'allegro';
  category_id: string;
  category_name: string | null;
  margin_pct: number;
  created_at: string;
  updated_at: string;
}

export async function GET() {
  try {
    const rules = await query<MarginRule>(
      'SELECT * FROM margin_rules ORDER BY account_id, category_source, category_name'
    );
    return NextResponse.json({ rules });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch margins', details: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { account_id, category_source, category_id, category_name, margin_pct } = await req.json();
    if (!account_id || margin_pct == null) {
      return NextResponse.json({ error: 'account_id and margin_pct are required' }, { status: 400 });
    }
    const src = category_source || 'all';
    const cid = src === 'all' ? 'all' : (category_id || 'all');

    const result = await query(
      `INSERT INTO margin_rules (account_id, category_source, category_id, category_name, margin_pct)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE category_name=VALUES(category_name), margin_pct=VALUES(margin_pct), updated_at=NOW()`,
      [account_id, src, cid, category_name || null, Number(margin_pct)]
    );
    const insertId = (result as unknown as { insertId: number }).insertId;
    const rule = await queryOne<MarginRule>('SELECT * FROM margin_rules WHERE id = ?', [insertId || (result as unknown as { insertId: number }).insertId]);
    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create margin rule', details: String(error) }, { status: 500 });
  }
}
