import { NextRequest, NextResponse } from 'next/server';
import { getAdapter } from '@/lib/marketplaces/registry';
import { MiraklAdapter } from '@/lib/marketplaces/mirakl/adapter';
import { cacheGet, cacheSet } from '@/lib/cache';

const TTL = 10 * 60 * 1000; // 10 min

/**
 * POST /api/marketplace/empik-status  Body: { eans: string[], accountId?, refresh? }
 * Returns { [ean]: { listed: boolean, active: boolean } } using a cached full offer index
 * (OF21 has no server-side EAN filter on this operator).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const eans: string[] = Array.isArray(body?.eans) ? body.eans.map(String) : [];
    const accountId = body?.accountId || 'empik';
    const refresh = !!body?.refresh;

    const adapter = await getAdapter(accountId);
    if (!(adapter instanceof MiraklAdapter)) {
      return NextResponse.json({ status: {}, warning: 'Brak konta Mirakl/Empik' });
    }

    const key = `empik:ean-index:${adapter.operator}`;
    let index = refresh ? null : cacheGet<Record<string, { active: boolean; sku: string }>>(key);
    if (!index) {
      index = await adapter.getAllEanIndex();
      cacheSet(key, index, TTL);
    }

    const status: Record<string, { listed: boolean; active: boolean }> = {};
    for (const ean of eans) {
      const hit = index[ean];
      status[ean] = { listed: !!hit, active: !!hit?.active };
    }
    return NextResponse.json({ status, total: Object.keys(index).length });
  } catch (error) {
    return NextResponse.json({ status: {}, error: String(error) }, { status: 500 });
  }
}
