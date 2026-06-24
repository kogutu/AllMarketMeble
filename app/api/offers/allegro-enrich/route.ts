import { NextRequest, NextResponse } from 'next/server';
import { getLiveOffer, getQualityScores } from '@/lib/allegro';

interface EnrichItem {
  db_id: number;
  allegro_offer_id: string;
  account_id: string | null;
}

export interface LiveOfferData {
  db_id: number;
  id: string;
  name: string;
  price: string | null;
  currency: string | null;
  stock_available: number | null;
  stock_sold: number | null;
  stock_unit: string | null;
  status: string | null;
  ended_by: string | null;
  category_id: string | null;
  external_id: string | null;
  quality_score: number | null;
  quality_issues: string[];
  quality_warnings: string[];
  in_campaigns: string[];
  error?: string;
}

// POST /api/offers/allegro-enrich
// Body: { items: EnrichItem[] }
export async function POST(req: NextRequest) {
  try {
    const { items }: { items: EnrichItem[] } = await req.json();
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ enriched: {} });
    }

    // Group by account_id
    const byAccount = new Map<string, EnrichItem[]>();
    for (const item of items) {
      const acc = item.account_id || 'default';
      if (!byAccount.has(acc)) byAccount.set(acc, []);
      byAccount.get(acc)!.push(item);
    }

    const results: Record<number, LiveOfferData> = {};

    await Promise.all(
      Array.from(byAccount.entries()).map(async ([accountId, accountItems]) => {
        // Fetch quality scores in one batch call per account
        const allegroIds = accountItems.map((i) => i.allegro_offer_id);
        const qualityMap = new Map<string, Record<string, unknown>>();

        try {
          const scores = await getQualityScores(allegroIds, accountId);
          for (const qs of scores) {
            const offerId = (qs as { offer?: { id?: string } }).offer?.id;
            if (offerId) qualityMap.set(offerId, qs as Record<string, unknown>);
          }
        } catch {
          // quality not critical
        }

        // Fetch each offer in parallel
        await Promise.all(
          accountItems.map(async (item) => {
            try {
              const data = await getLiveOffer(item.allegro_offer_id, accountId);
              const qs = qualityMap.get(item.allegro_offer_id);

              results[item.db_id] = {
                db_id: item.db_id,
                id: String(data.id || ''),
                name: String(data.name || ''),
                price: (data.sellingMode as { price?: { amount?: string } } | undefined)?.price?.amount ?? null,
                currency: (data.sellingMode as { price?: { currency?: string } } | undefined)?.price?.currency ?? null,
                stock_available: (data.stock as { available?: number } | undefined)?.available ?? null,
                stock_sold: (data.stock as { sold?: number } | undefined)?.sold ?? null,
                stock_unit: (data.stock as { unit?: string } | undefined)?.unit ?? null,
                status: (data.publication as { status?: string } | undefined)?.status ?? null,
                ended_by: (data.publication as { endedBy?: string } | undefined)?.endedBy ?? null,
                category_id: (data.category as { id?: string } | undefined)?.id ?? null,
                external_id: (data.external as { id?: string } | undefined)?.id ?? null,
                quality_score: qs ? ((qs as { score?: number }).score ?? null) : null,
                quality_issues: qs
                  ? ((qs as { issues?: { message?: string }[] }).issues || []).map((i) => i.message || String(i))
                  : [],
                quality_warnings: qs
                  ? ((qs as { warnings?: { message?: string }[] }).warnings || []).map((w) => w.message || String(w))
                  : [],
                in_campaigns: qs
                  ? ((qs as { campaigns?: { name?: string }[] }).campaigns || []).map((c) => c.name || String(c))
                  : [],
              };
            } catch (e) {
              results[item.db_id] = {
                db_id: item.db_id,
                id: item.allegro_offer_id,
                name: '',
                price: null,
                currency: null,
                stock_available: null,
                stock_sold: null,
                stock_unit: null,
                status: null,
                ended_by: null,
                category_id: null,
                external_id: null,
                quality_score: null,
                quality_issues: [],
                quality_warnings: [],
                in_campaigns: [],
                error: String(e),
              };
            }
          })
        );
      })
    );

    return NextResponse.json({ enriched: results });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
