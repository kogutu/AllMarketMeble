import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

interface ViewRow {
  id: number; marketplace: string; name: string;
  columns_json: unknown; is_default: number;
}

/** GET /api/grid-views?slug=…  → saved views for a marketplace. */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug') || '';
  const rows = await query<ViewRow>(
    'SELECT id, marketplace, name, columns_json, is_default FROM grid_views WHERE marketplace = ? ORDER BY is_default DESC, name ASC',
    [slug]
  );
  const views = rows.map((r) => ({
    id: r.id, marketplace: r.marketplace, name: r.name, is_default: !!r.is_default,
    columns: typeof r.columns_json === 'string' ? JSON.parse(r.columns_json) : r.columns_json,
  }));
  return NextResponse.json({ views });
}

/** POST /api/grid-views  → create or update a view. Body: { id?, slug, name, columns, is_default? }. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const slug = String(body?.slug || '');
    const name = String(body?.name || '').trim();
    const columns = body?.columns;
    const isDefault = body?.is_default ? 1 : 0;
    if (!slug || !name || !Array.isArray(columns)) {
      return NextResponse.json({ error: 'slug, name i columns są wymagane' }, { status: 400 });
    }
    const colsJson = JSON.stringify(columns);

    if (isDefault) await query('UPDATE grid_views SET is_default = 0 WHERE marketplace = ?', [slug]);

    if (body?.id) {
      await query('UPDATE grid_views SET name = ?, columns_json = ?, is_default = ? WHERE id = ?', [name, colsJson, isDefault, body.id]);
      return NextResponse.json({ id: body.id, success: true });
    }
    const res = await query<{ insertId: number }>(
      'INSERT INTO grid_views (marketplace, name, columns_json, is_default) VALUES (?,?,?,?)',
      [slug, name, colsJson, isDefault]
    );
    const id = (res as unknown as { insertId: number }).insertId;
    return NextResponse.json({ id, success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** DELETE /api/grid-views?id=… */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await queryOne('DELETE FROM grid_views WHERE id = ?', [id]);
  return NextResponse.json({ success: true });
}
