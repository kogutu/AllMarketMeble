import { NextRequest, NextResponse } from 'next/server';
import { getProduct } from '@/lib/typesense';
import { getFurnitureLeaves, CategoryLeaf } from '@/lib/allegroCategoryTree';
import { suggestCategoryWithAI, AllegroCategory } from '@/lib/openai';

/** Ostatni (najbardziej szczegółowy) segment ścieżki kategorii produktu, np. "/Meble/Biurka" → "Biurka". */
function breadcrumbLeaf(breadcrumbs?: string): string {
  if (!breadcrumbs) return '';
  return breadcrumbs.split('/').map((s) => s.trim()).filter(Boolean).pop() || '';
}

function tokenize(s: string): string[] {
  const raw = s.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]+/g, ' ').split(' ').filter((t) => t.length >= 3);
  return raw.filter((t, i) => raw.indexOf(t) === i); // unikalne
}

/** Zawęża liście drzewa do najbardziej pasujących wg pokrycia tokenami nazwy/ścieżki produktu. */
function rankLeaves(leaves: CategoryLeaf[], product: { name: string; model?: string; breadcrumbs?: string }, max = 60): CategoryLeaf[] {
  const tokens = tokenize(`${breadcrumbLeaf(product.breadcrumbs)} ${product.name} ${product.model || ''}`);
  if (tokens.length === 0) return leaves.slice(0, max);
  const scored = leaves
    .map((c) => {
      const hay = `${c.name} ${c.path}`.toLowerCase();
      let score = 0;
      for (const t of tokens) if (hay.includes(t)) score++;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  // Gdy nic nie pasuje tokenami — oddajemy cały (ograniczony) zestaw, niech AI zdecyduje.
  return (scored.length ? scored.slice(0, max).map((x) => x.c) : leaves.slice(0, max));
}

export async function POST(req: NextRequest) {
  try {
    const { productId, collection = process.env.TYPESENSE_COLLECTION_TYRES || 'meble' } = await req.json();
    if (!productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 });

    const product = await getProduct(collection, productId);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    // Bazą sugestii jest pełne, cache'owane raz dziennie drzewo kategorii Meble (a nie cross-branch
    // matching-categories). Z liści gałęzi meblowej wybieramy najlepszych kandydatów dla AI.
    const leaves = await getFurnitureLeaves();
    if (leaves.length === 0) {
      return NextResponse.json({ error: 'Furniture category tree unavailable' }, { status: 503 });
    }

    const candidates: AllegroCategory[] = rankLeaves(leaves, product).map((c) => ({
      id: c.id,
      name: c.name,
      leaf: true,
      path: c.path,
    }));

    const result = await suggestCategoryWithAI(product, candidates);
    if (!result) return NextResponse.json({ error: 'Could not suggest category' }, { status: 422 });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Suggest category failed', details: String(error) }, { status: 500 });
  }
}
