import OpenAI from 'openai';
import type { MebleProduct } from '@/types';
import type { MarketplaceCategory } from '@/lib/marketplaces/types';

let client: OpenAI | null = null;
function getClient(): OpenAI {
  // Timeout + retry, żeby wolne/wiszące wywołanie AI nie blokowało formularza w nieskończoność.
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000, maxRetries: 2 });
  return client;
}

const FILL_MODEL = process.env.OPENAI_FILL_MODEL || process.env.OPENAI_MODEL || 'gpt-4o';

function parseJson<T>(text: string): T | null {
  if (!text) return null;
  let s = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try { return JSON.parse(s) as T; } catch { return null; }
}

async function ask(prompt: string, maxTokens = 400): Promise<string> {
  const res = await getClient().responses.create({
    model: FILL_MODEL,
    input: prompt,
    temperature: 0.2,
    max_output_tokens: maxTokens,
  });
  return res.output_text || '';
}

/** Pick the best Kaufland leaf category for a product from candidate categories. */
export async function suggestKauflandCategory(
  product: MebleProduct,
  candidates: MarketplaceCategory[]
): Promise<{ code: string; label: string } | null> {
  if (candidates.length === 0) return null;
  const list = candidates
    .map((c) => `code="${c.code}" label="${c.label}"${c.leaf ? ' [LIŚĆ]' : ''}`)
    .join('\n');
  const prompt = `Masz mebel: "${product.name}", model: ${product.model || '-'}, kategoria źródłowa: ${product.kind || '-'}.
Dane: ${JSON.stringify(product.attrs || {}).slice(0, 600)}

Wybierz JEDNĄ najlepiej pasującą kategorię Kaufland z listy. Preferuj kategorie-liście [LIŚĆ].
${list}

Zwróć TYLKO JSON: {"code":"...","label":"..."}`;
  const parsed = parseJson<{ code?: string; label?: string }>(await ask(prompt, 120));
  if (!parsed?.code) return null;
  const match = candidates.find((c) => c.code === parsed.code);
  return { code: parsed.code, label: match?.label || parsed.label || '' };
}

export interface KauflandFillResult {
  title: string;
  handling_time: number;
  description?: string;
  short_description?: string;
  form?: string;
  surface_style?: string;
  suitable_for_location?: string;
  extendable?: boolean;
  foldable?: boolean;
  product_dimensions?: string;
  package_included?: string;
}

/**
 * AI wypełnia pola oferty Kaufland: tytuł (note), handling_time, oraz pola product data
 * (opis, krótki opis, kształt, styl, miejsce użytkowania, rozłożenie, wymiary, zakres dostawy).
 */
export async function fillKauflandForm(
  product: MebleProduct,
  categoryLabel: string
): Promise<KauflandFillResult> {
  const attrs = (product.attrs || {}) as Record<string, unknown>;
  const record = {
    name: product.name, model: product.model, ean: product.ean,
    color: product.color?.name,
    attrs: { kolor: attrs.kolor, material: attrs.materiał ?? attrs.material,
      szerokosc: attrs.szerokość ?? attrs.szerokosc, wysokosc: attrs.wysokość ?? attrs.wysokosc,
      glebokosc: attrs.głębokość ?? attrs.glebokosc, dlugosc: attrs.długość ?? attrs.dlugosc,
      waga: attrs.waga_produktu_kg, przeznaczenie: attrs.przeznaczenie, styl: attrs.styl_wnętrzarski },
    description: (product.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 2000),
  };
  const prompt = `Jesteś ekspertem od marketingu mebli. Na podstawie danych produktu wypełnij pola oferty Kaufland.
Produkt: ${record.name}
Kategoria: ${categoryLabel}
Dane (JSON): ${JSON.stringify(record, null, 2)}

Zwróć TYLKO JSON (wszystkie pola po polsku):
{
  "title": "atrakcyjny tytuł do 120 znaków: nazwa + kluczowe cechy, bez ceny i wysyłki",
  "handling_time": <1-5 dni>,
  "description": "pełny opis HTML do 3000 znaków: cechy, materiały, zastosowanie, wymiary",
  "short_description": "krótki opis bez HTML do 200 znaków: najważniejsze cechy produktu",
  "form": "kształt mebla np. prostokątny/owalny/okrągły/kwadratowy (lub null)",
  "surface_style": "styl wnętrza np. nowoczesny/skandynawski/industrialny/glamour (lub null)",
  "suitable_for_location": "miejsce użytkowania np. salon/sypialnia/biuro (lub null)",
  "extendable": <true/false — czy blat rozkładany>,
  "foldable": <true/false — czy składany>,
  "product_dimensions": "wymiary w formacie 'S x G x W cm' (lub null)",
  "package_included": "co w zestawie np. 1x stolik, 4x śruby (lub null)"
}`;
  const parsed = parseJson<KauflandFillResult>(await ask(prompt, 800));
  return {
    title: parsed?.title || product.name,
    handling_time: Number(parsed?.handling_time) > 0 ? Math.min(5, Number(parsed!.handling_time)) : 1,
    description: parsed?.description || undefined,
    short_description: parsed?.short_description || undefined,
    form: parsed?.form || undefined,
    surface_style: parsed?.surface_style || undefined,
    suitable_for_location: parsed?.suitable_for_location || undefined,
    extendable: typeof parsed?.extendable === 'boolean' ? parsed.extendable : undefined,
    foldable: typeof parsed?.foldable === 'boolean' ? parsed.foldable : undefined,
    product_dimensions: parsed?.product_dimensions || undefined,
    package_included: parsed?.package_included || undefined,
  };
}
