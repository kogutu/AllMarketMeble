import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export interface PriceOverride {
  id: number;
  typesense_id: string;
  account_id: string;
  price: number;
}

// GET /api/prices?typesense_ids=id1,id2,...
export async function GET(req: NextRequest) {
  try {
    const ids = req.nextUrl.searchParams.get('typesense_ids');
    if (!ids) return NextResponse.json({ overrides: [] });

    const idList = ids.split(',').filter(Boolean);
    if (idList.length === 0) return NextResponse.json({ overrides: [] });

    const placeholders = idList.map(() => '?').join(',');
    const overrides = await query<PriceOverride>(
      `SELECT * FROM product_price_overrides WHERE typesense_id IN (${placeholders})`,
      idList
    );
    return NextResponse.json({ overrides });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/prices  { typesense_id, account_id, price }
export async function POST(req: NextRequest) {
  try {
    const { typesense_id, account_id, price } = await req.json();
    if (!typesense_id || !account_id || price == null) {
      return NextResponse.json({ error: 'typesense_id, account_id and price are required' }, { status: 400 });
    }
    await query(
      `INSERT INTO product_price_overrides (typesense_id, account_id, price)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE price = VALUES(price), updated_at = NOW()`,
      [typesense_id, account_id, Number(price)]
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/prices?typesense_id=...&account_id=...
export async function DELETE(req: NextRequest) {
  try {
    const typesense_id = req.nextUrl.searchParams.get('typesense_id');
    const account_id = req.nextUrl.searchParams.get('account_id');
    if (!typesense_id || !account_id) {
      return NextResponse.json({ error: 'typesense_id and account_id are required' }, { status: 400 });
    }
    await query(
      'DELETE FROM product_price_overrides WHERE typesense_id = ? AND account_id = ?',
      [typesense_id, account_id]
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
