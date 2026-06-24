import { NextRequest, NextResponse } from 'next/server';
import { getProduct } from '@/lib/typesense';
import { MiraklAdapter } from '@/lib/marketplaces/mirakl/adapter';
import { suggestMiraklCategory } from '@/lib/marketplaces/mirakl/ai';
import type { MarketplaceCategory } from '@/lib/marketplaces/types';

/** Strip Polish diacritics + lowercase for declension-tolerant matching. */
function norm(s: string): string {
  return (s || '').toLowerCase()
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l')
    .replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/[źż]/g, 'z');
}

/**
 * POST /api/mirakl/suggest-category
 * Body: { productId, operator, accountId?, collection? }
 *
 * Strategy (avoid wasting AI):
 *  1. Pattern match — product names are "kategoria-model-…" (e.g. "łóżko-gaston-140"), so the
 *     first token is the category word. Match it to an Empik leaf category under the furniture
 *     ("Meble") subtree. If found, return it WITHOUT calling AI.
 *  2. Fallback — weighted token scoring builds candidates, AI picks the best.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const operator = String(body?.operator || '');
    const accountId = String(body?.accountId || operator || 'default');
    const productId = String(body?.productId || '');
    const collection = String(body?.collection || 'meble');
    if (!operator || !productId) {
      return NextResponse.json({ error: 'operator and productId required' }, { status: 400 });
    }

    const product = await getProduct(collection, productId);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const adapter = await MiraklAdapter.create(operator, accountId);
    const all = await adapter.listCategories();

    // Ancestry map for "is under Meble?" checks.
    const byCode = new Map(all.map((c) => [c.code, c]));
    const underMeble = (c: MarketplaceCategory): boolean => {
      let cur: MarketplaceCategory | undefined = c;
      for (let i = 0; i < 10 && cur; i++) {
        if (norm(cur.label).includes('meble')) return true;
        cur = cur.parentCode ? byCode.get(cur.parentCode) : undefined;
      }
      return false;
    };

    // ── 1) Deterministic pattern match from the leading category word ─────────
    const keyword = norm(product.name).split(/[-\s,]+/).filter(Boolean)[0] || '';
    const root = keyword.length >= 4 ? keyword.slice(0, Math.max(4, keyword.length - 1)) : keyword;
    if (root.length >= 3) {
      const matches = all.filter((c) => {
        const firstWord = norm(c.label).split(/[\s,/]+/)[0] || '';
        return firstWord.startsWith(root) || (firstWord.length >= 4 && root.startsWith(firstWord));
      });
      const ranked = matches
        .map((c) => ({ c, meble: underMeble(c) }))
        .sort((a, b) =>
          Number(b.meble) - Number(a.meble) ||
          Number(b.c.leaf) - Number(a.c.leaf) ||
          a.c.label.length - b.c.label.length
        );
      const best = ranked[0];
      if (best && best.meble) {
        return NextResponse.json({
          categoryCode: best.c.code,
          categoryLabel: best.c.label,
          source: 'pattern',
          keyword,
        });
      }
    }

    // ── 2) Weighted token scoring + AI fallback ──────────────────────────────
    const tokenWeights = new Map<string, number>();
    const addTokens = (s: string, weight: number) => {
      for (const w of norm(s).split(/[^0-9a-z]+/i)) {
        if (w.length >= 4) {
          tokenWeights.set(w, Math.max(tokenWeights.get(w) || 0, weight));
          tokenWeights.set(w.slice(0, 5), Math.max(tokenWeights.get(w.slice(0, 5)) || 0, weight));
        }
      }
    };
    addTokens(product.name, 1);
    addTokens(product.kind, 4);
    const tokens = Array.from(tokenWeights.entries());

    const scored = all
      .map((c) => {
        const label = norm(c.label);
        const score = tokens.reduce((n, [t, w]) => (label.includes(t) ? n + w : n), 0)
          + (underMeble(c) ? 2 : 0);
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (a.c.leaf === b.c.leaf ? 0 : a.c.leaf ? -1 : 1));

    const candidates: MarketplaceCategory[] = scored.slice(0, 30).map((x) => x.c);
    if (candidates.length === 0) {
      return NextResponse.json({ categoryCode: null, categoryLabel: null, source: 'none' });
    }

    const picked = await suggestMiraklCategory(product, candidates).catch(() => null);
    const result = picked ?? { code: candidates[0].code, label: candidates[0].label };
    return NextResponse.json({
      categoryCode: result.code,
      categoryLabel: result.label,
      source: picked ? 'ai' : 'fallback',
    });
  } catch (error) {
    return NextResponse.json({ error: 'suggest-category failed', details: String(error) }, { status: 500 });
  }
}
