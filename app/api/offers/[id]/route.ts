import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { AllegroOffer } from '@/types';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const offer = await queryOne<AllegroOffer>(
      'SELECT * FROM allegro_offers WHERE id = ?',
      [params.id]
    );

    if (!offer) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    return NextResponse.json(offer);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch offer', details: String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const {
      form_data,
      title,
      description,
      price,
      quantity,
      category_id,
      status,
    } = body;

    const setClauses: string[] = [];
    const setParams: (string | number | null)[] = [];

    if (form_data !== undefined) { setClauses.push('form_data = ?'); setParams.push(JSON.stringify(form_data)); }
    if (title !== undefined)     { setClauses.push('title = ?');     setParams.push(title ?? null); }
    if (description !== undefined) { setClauses.push('description = ?'); setParams.push(description ?? null); }
    if (price !== undefined)     { setClauses.push('price = ?');     setParams.push(price ?? null); }
    if (quantity !== undefined)  { setClauses.push('quantity = ?');  setParams.push(quantity ?? null); }
    if (category_id !== undefined) { setClauses.push('category_id = ?'); setParams.push(category_id ?? null); }
    if (status !== undefined)    { setClauses.push('status = ?');    setParams.push(status ?? null); }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    setClauses.push('updated_at = NOW()');

    await query(
      `UPDATE allegro_offers SET ${setClauses.join(', ')} WHERE id = ?`,
      [...setParams, params.id]
    );

    const offer = await queryOne<AllegroOffer>(
      'SELECT * FROM allegro_offers WHERE id = ?',
      [params.id]
    );

    return NextResponse.json(offer);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update offer', details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await query('DELETE FROM allegro_offers WHERE id = ?', [params.id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete offer', details: String(error) },
      { status: 500 }
    );
  }
}
