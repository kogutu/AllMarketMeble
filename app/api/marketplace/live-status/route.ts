import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

interface Row { marketplace: string; typesense_id: string | null; ean: string | null; active: number }
type Status = { listed: boolean; active: boolean };

/**
 * POST /api/marketplace/live-status  Body: { typesense_ids: string[], eans?: string[] }
 * Returns per typesense_id a map of marketplace slug → {listed, active}, from the persisted
 * marketplace_live_offers table (matched by typesense_id or EAN).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ids: string[] = Array.isArray(body?.typesense_ids) ? body.typesense_ids.map(String) : [];
    const eans: string[] = Array.isArray(body?.eans) ? body.eans.map(String) : [];
    if (ids.length === 0 && eans.length === 0) return NextResponse.json({ status: {}, statusByEan: {} });

    const conds: string[] = [];
    const params: string[] = [];
    if (ids.length) { conds.push(`typesense_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
    if (eans.length) { conds.push(`ean IN (${eans.map(() => '?').join(',')})`); params.push(...eans); }

    const rows = await query<Row>(
      `SELECT marketplace, typesense_id, ean, active FROM marketplace_live_offers WHERE ${conds.join(' OR ')}`,
      params
    );

    const byTs: Record<string, Record<string, Status>> = {};
    const byEan: Record<string, Record<string, Status>> = {};
    const apply = (bucket: Record<string, Status>, r: Row) => {
      const s = (bucket[r.marketplace] ??= { listed: false, active: false });
      s.listed = true;
      if (r.active) s.active = true;
    };
    for (const r of rows) {
      if (r.typesense_id) apply((byTs[r.typesense_id] ??= {}), r);
      if (r.ean) apply((byEan[r.ean] ??= {}), r);
    }

    return NextResponse.json({ status: byTs, statusByEan: byEan });
  } catch (error) {
    return NextResponse.json({ status: {}, statusByEan: {}, error: String(error) }, { status: 500 });
  }
}
