import OpenAI from 'openai';
import type { MebleProduct } from '@/types';
import type { MarketplaceCategory, MarketplaceAttribute } from '@/lib/marketplaces/types';

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

const FILL_MODEL = process.env.OPENAI_FILL_MODEL || process.env.OPENAI_MODEL || 'gpt-4o';

/** Parse a JSON object from a model response, tolerating ```json fences / surrounding text. */
function parseJson<T>(text: string): T | null {
  if (!text) return null;
  let s = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try { return JSON.parse(s) as T; } catch { return null; }
}

async function ask(prompt: string, maxTokens = 1200): Promise<string> {
  const res = await getClient().responses.create({
    model: FILL_MODEL,
    input: prompt,
    temperature: 0.2,
    max_output_tokens: maxTokens,
  });
  return res.output_text || '';
}

/**
 * Pick the best matching Mirakl category for a product from a list of candidate (preferably leaf)
 * categories. Returns null if nothing fits.
 */
export async function suggestMiraklCategory(
  product: MebleProduct,
  candidates: MarketplaceCategory[]
): Promise<{ code: string; label: string } | null> {
  if (candidates.length === 0) return null;

  const list = candidates
    .map((c) => `code="${c.code}" label="${c.label}"${c.leaf ? ' [LIŚĆ]' : ''}`)
    .join('\n');

  const prompt = `Masz mebel: "${product.name}", model: ${product.model || '-'}, kategoria źródłowa: ${product.kind || '-'}.
Dane dodatkowe: ${JSON.stringify(product.attrs || {}).slice(0, 800)}

Wybierz JEDNĄ najlepiej pasującą kategorię Empik (Mirakl) z listy. Preferuj kategorie-liście [LIŚĆ].
${list}

Zwróć TYLKO JSON: {"code": "...", "label": "..."}`;

  const parsed = parseJson<{ code?: string; label?: string }>(await ask(prompt, 120));
  if (!parsed?.code) return null;
  const match = candidates.find((c) => c.code === parsed.code);
  return { code: parsed.code, label: match?.label || parsed.label || '' };
}

export interface MiraklFillResult {
  title: string;
  description: string;
  attributes: Record<string, string | string[]>;
}

/**
 * Fill a Mirakl offer form (title, description, category attribute values) from product data.
 * For LIST attributes the AI must return value-list codes; for text attributes, plain strings.
 */
export async function fillMiraklForm(
  product: MebleProduct,
  categoryLabel: string,
  attributes: MarketplaceAttribute[]
): Promise<MiraklFillResult> {
  const DICT_LIMIT = 40;
  const attrList = attributes
    .map((a) => {
      const vals = a.values?.length
        ? `\n     Dozwolone wartości (code="label"): ${a.values.slice(0, DICT_LIMIT).map((v) => `${v.code}="${v.label}"`).join(', ')}${a.values.length > DICT_LIMIT ? ` … (${a.values.length})` : ''}`
        : '';
      return `  - code="${a.code}" label="${a.label}" type=${a.type}${a.required ? ' [WYMAGANY]' : ''}${a.multiple ? ' [MULTI]' : ''}${vals}`;
    })
    .join('\n');

  const gallery = product.gallery_images?.length ? product.gallery_images : (product.img ? [product.img] : []);

  // Send a rich (but trimmed) record so AI can answer globally, including image assignment.
  const record = {
    name: product.name,
    subtitle: product.subtitle,
    model: product.model,
    ean: product.ean,
    sku: product.sku,
    price: product.price_gross,
    color: product.color,
    description: (product.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 2500),
    attrs: product.attrs,
    gallery_images: gallery,
  };

  const prompt = `Na podstawie pełnego rekordu mebla wypełnij ofertę dla Empik (Mirakl), kategoria: "${categoryLabel}".
Najpierw skorzystaj z nazwy produktu, potem z atrybutów i opisu. Dopasowuj wartości 1:1; przy wątpliwości pomiń atrybut (chyba że [WYMAGANY]). Zwróć TYLKO JSON.

Pełny rekord produktu (JSON):
${JSON.stringify(record, null, 2)}

Atrybuty kategorii do wypełnienia:
${attrList || '  (brak atrybutów)'}

Zwróć JSON:
{
  "title": "tytuł oferty (zwięzły, do 130 znaków)",
  "description": "opis HTML (dozwolone: <p>,<ul>,<li>,<b>) — bez ceny i wysyłki",
  "attributes": { "<code atrybutu>": "<wartość lub code wartości; tablica dla [MULTI]>" }
}

Zasady:
- Dla type=LIST/LIST_MULTIPLE_VALUES: użyj DOKŁADNIE code z listy dozwolonych wartości (nie etykiety).
- Dla [MULTI]: wartość = tablica code.
- Dla type tekstowych/liczbowych: zwykły string.
- Dla type=MEDIA: wstaw URL zdjęcia z gallery_images. Zdjęcie główne/okładki = gallery_images[0];
  kolejne "Dodatkowe zdjęcia (n)" = gallery_images[n] po kolei. Atrybutów certyfikatów/GPSR (np. AGHL) NIE wypełniaj zdjęciami produktu.
- Uwzględnij WSZYSTKIE atrybuty [WYMAGANY], których wartość da się ustalić.
- Pomiń atrybuty, których nie da się określić (poza wymaganymi).`;

  const parsed = parseJson<MiraklFillResult>(await ask(prompt, 1500));
  return {
    title: parsed?.title || product.name,
    description: parsed?.description || product.description || '',
    attributes: parsed?.attributes || {},
  };
}
