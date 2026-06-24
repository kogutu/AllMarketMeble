import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

interface ErrorRow {
  id: number;
  account_id: string;
  offer_id: number | null;
  allegro_offer_id: string | null;
  error_json: string;
  form_data_snapshot: string | null;
  created_at: string;
  offer_title: string | null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const limit = Math.min(Number(searchParams.get('limit') || 50), 200);
  const offset = Number(searchParams.get('offset') || 0);

  const rows = await query<ErrorRow>(
    `SELECT e.*, o.title as offer_title
     FROM allegro_publish_errors e
     LEFT JOIN allegro_offers o ON o.id = e.offer_id
     ORDER BY e.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  return NextResponse.json({ errors: rows });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json() as { id?: number };
  if (id) {
    await query('DELETE FROM allegro_publish_errors WHERE id = ?', [id]);
  } else {
    await query('TRUNCATE TABLE allegro_publish_errors');
  }
  return NextResponse.json({ ok: true });
}
