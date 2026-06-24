import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { MarginRule } from '../route';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { margin_pct, category_name } = await req.json();
    await query(
      'UPDATE margin_rules SET margin_pct=?, category_name=?, updated_at=NOW() WHERE id=?',
      [Number(margin_pct), category_name || null, params.id]
    );
    const rule = await queryOne<MarginRule>('SELECT * FROM margin_rules WHERE id = ?', [params.id]);
    return NextResponse.json(rule);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update margin rule', details: String(error) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await query('DELETE FROM margin_rules WHERE id = ?', [params.id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete margin rule', details: String(error) }, { status: 500 });
  }
}
