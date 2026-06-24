import OpenAI from 'openai';
import type { MebleProduct } from '@/types';
import type { MarketplaceCategory } from '@/lib/marketplaces/types';

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
  title: string;       // offer note / title
  handling_time: number;
}

/**
 * Kaufland has no per-category attribute schema — products are EAN-matched in the catalog.
 * So AI only helps with a clean offer title (note) and a sensible handling time.
 */
export async function fillKauflandForm(
  product: MebleProduct,
  categoryLabel: string
): Promise<KauflandFillResult> {
  const record = {
    name: product.name,
    model: product.model,
    ean: product.ean,
    color: product.color,
    attrs: product.attrs,
    description: (product.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1200),
  };
  const prompt = `Na podstawie rekordu mebla przygotuj dane oferty Kaufland, kategoria: "${categoryLabel}".
Rekord (JSON):
${JSON.stringify(record, null, 2)}

Zwróć TYLKO JSON:
{
  "title": "zwięzły tytuł oferty (note) do 120 znaków, bez ceny i wysyłki",
  "handling_time": <liczba dni przygotowania do wysyłki, 1-5; domyślnie 1>
}`;
  const parsed = parseJson<{ title?: string; handling_time?: number }>(await ask(prompt, 200));
  return {
    title: parsed?.title || product.name,
    handling_time: Number(parsed?.handling_time) > 0 ? Math.min(5, Number(parsed!.handling_time)) : 1,
  };
}
