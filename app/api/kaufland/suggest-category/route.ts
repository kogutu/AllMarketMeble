import { NextRequest, NextResponse } from 'next/server';
import { getProduct } from '@/lib/typesense';
import { KauflandAdapter } from '@/lib/marketplaces/kaufland/adapter';
import { suggestKauflandCategory } from '@/lib/marketplaces/kaufland/ai';

/**
 * POST /api/kaufland/suggest-category
 * Body: { productId, collection? } → { categoryCode, categoryLabel } | {}
 * Heuristic: search leaf categories by product name tokens, then let AI pick the best.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const productId = String(body?.productId || '');
    const collection = String(body?.collection || 'meble');
    if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });

    const product = await getProduct(collection, productId);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const adapter = await KauflandAdapter.create('kaufland');

    // Zbierz kandydatów z kilku fraz. Tokenizujemy po spacjach/myślnikach/interpunkcji
    // (np. „Stolik-kawowy alpin-b biały," → stolik, kawowy, alpin, biały) i odrzucamy
    // kolory/słowa-śmieci oraz tokeny <3 znaki, by trafiać w nazwy kategorii, a nie kolory.
    const STOP = new Set(['bialy', 'bialy,', 'czarny', 'szary', 'brazowy', 'bezowy', 'zielony', 'niebieski',
      'czerwony', 'zloty', 'srebrny', 'podstawa', 'nogi', 'noga', 'rama', 'kolor', 'mat', 'polysk', 'dab', 'buk']);
    const norm = (s: string) => s.toLowerCase()
      .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l')
      .replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/[źż]/g, 'z');
    const nameTokens = (product.name || '').split(/[\s\-_,.;:/()]+/).filter(Boolean)
      .filter((t) => t.length >= 3 && !STOP.has(norm(t)));
    // Frazy: całe źródłowe `kind`, pełna nazwa (dopasowanie tokenowe), potem pojedyncze tokeny.
    const phrases = [product.kind, product.name, ...nameTokens].filter(Boolean) as string[];
    const seen = new Set<string>();
    const candidates = [] as Awaited<ReturnType<typeof adapter.searchCategories>>;
    for (const ph of phrases) {
      const res = await adapter.searchCategories(ph).catch(() => []);
      for (const c of res) if (!seen.has(c.code)) { seen.add(c.code); candidates.push(c); }
      if (candidates.length >= 40) break;
    }
    if (candidates.length === 0) return NextResponse.json({});

    const pick = await suggestKauflandCategory(product, candidates);
    if (!pick) return NextResponse.json({});
    return NextResponse.json({ categoryCode: pick.code, categoryLabel: pick.label });
  } catch (error) {
    return NextResponse.json({ error: 'suggest failed', details: String(error) }, { status: 500 });
  }
}
