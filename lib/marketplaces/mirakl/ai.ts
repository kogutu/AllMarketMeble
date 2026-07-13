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

/** Normalize for tolerant matching (lowercase, strip diacritics + non-alphanumerics). */
function norm(s: string): string {
  return (s || '').toLowerCase()
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l')
    .replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/[źż]/g, 'z')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Compact product record shared by the title and attribute prompts.
 *  gallery_images intentionally excluded — MEDIA attributes are populated deterministically
 *  by imageDefaults() in the form, not by AI, to prevent URL corruption. */
function productRecord(product: MebleProduct) {
  return {
    name: product.name,
    subtitle: product.subtitle,
    model: product.model,
    ean: product.ean,
    sku: product.sku,
    price: product.price_gross,
    color: product.color,
    description: (product.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 2500),
    attrs: product.attrs,
  };
}

/**
 * Lokalne podpowiedzi dla atrybutów LIST: jeśli któraś z dozwolonych wartości pasuje do danych
 * produktu (kolor, atrybuty, nazwa), podajemy jej code jako mocną sugestię. Dzięki temu AI nie
 * gubi atrybutów typu „Kolor", których właściwa wartość bywa daleko poza widoczną częścią listy.
 */
function localAttributeHints(product: MebleProduct, attributes: MarketplaceAttribute[]): Record<string, string[]> {
  const haystackTokens = new Set<string>();
  const push = (s?: string) => { for (const t of norm(s || '').split(' ')) if (t.length >= 3) haystackTokens.add(t); };
  push(product.color?.name);
  push(product.name);
  for (const v of Object.values(product.attrs || {})) push(String(v));

  const hints: Record<string, string[]> = {};
  for (const a of attributes) {
    if (!a.values?.length) continue;
    const matched: string[] = [];
    for (const v of a.values) {
      const vt = norm(v.label).split(' ').filter((t) => t.length >= 3);
      if (vt.length && vt.every((t) => haystackTokens.has(t))) matched.push(v.code);
    }
    if (matched.length) hints[a.code] = a.multiple ? matched : [matched[0]];
  }
  return hints;
}

/** Tytuł oferty Empik — osobna, wyspecjalizowana funkcja (nie miesza się z parametrami). */
export async function generateMiraklTitle(product: MebleProduct, categoryLabel: string): Promise<string> {
  const prompt = `Ułóż zwięzły, sprzedażowy tytuł oferty MEBLA na Empik (kategoria: "${categoryLabel}"), max 130 znaków.
Bazuj na nazwie i kluczowych cechach. Bez ceny, wysyłki, znaków specjalnych i CAPS-LOCK.

Dane: ${JSON.stringify({ name: product.name, model: product.model, color: product.color?.name, attrs: product.attrs })}

Zwróć TYLKO JSON: {"title": "..."}`;
  const parsed = parseJson<{ title?: string }>(await ask(prompt, 200));
  return (parsed?.title || product.name).slice(0, 130);
}

/** Parametry (atrybuty kategorii) + opis — osobna funkcja, skupiona wyłącznie na wypełnieniu pól. */
export async function fillMiraklAttributes(
  product: MebleProduct,
  categoryLabel: string,
  attributes: MarketplaceAttribute[]
): Promise<{ description: string; attributes: Record<string, string | string[]> }> {
  const hints = localAttributeHints(product, attributes);

  // Limit listowanych wartości — pełne dumpy (150×62 atrybuty) przekraczały limit TPM (429).
  // Lokalne dopasowania (hints) i tak wymuszają kluczowe wartości (kolor/materiał), więc do promptu
  // wysyłamy mniejszą próbkę: zawsze wpis dopasowany + do DICT_LIMIT pozostałych.
  const DICT_LIMIT = 40;
  const sampleValues = (a: MarketplaceAttribute): string => {
    if (!a.values?.length) return '';
    const hinted = new Set(hints[a.code] || []);
    const ordered = [
      ...a.values.filter((v) => hinted.has(v.code)),
      ...a.values.filter((v) => !hinted.has(v.code)),
    ].slice(0, DICT_LIMIT);
    return `\n     Dozwolone wartości (code="label"): ${ordered.map((v) => `${v.code}="${v.label}"`).join(', ')}${a.values.length > ordered.length ? ` … (${a.values.length})` : ''}`;
  };
  const attrList = attributes
    .map((a) => `  - code="${a.code}" label="${a.label}" type=${a.type}${a.required ? ' [WYMAGANY]' : ''}${a.multiple ? ' [MULTI]' : ''}${sampleValues(a)}`)
    .join('\n');

  const hintsBlock = Object.keys(hints).length
    ? `\nWstępnie dopasowane wartości (użyj ich, o ile pasują): ${JSON.stringify(hints)}`
    : '';

  const prompt = `Na podstawie pełnego rekordu mebla wypełnij ATRYBUTY oferty dla Empik (Mirakl), kategoria: "${categoryLabel}".
Wypełnij MAKSYMALNIE dużo atrybutów (kolor, materiał, wymiary, styl itd.) — korzystaj z nazwy, koloru, atrybutów i opisu. Dopasowuj 1:1. Zwróć TYLKO JSON.

Pełny rekord produktu (JSON):
${JSON.stringify(productRecord(product), null, 2)}
${hintsBlock}

Atrybuty kategorii do wypełnienia:
${attrList || '  (brak atrybutów)'}

Zwróć JSON:
{
  "description": "opis HTML (dozwolone: <p>,<ul>,<li>,<b>) — bez ceny i wysyłki",
  "attributes": { "<code atrybutu>": "<wartość lub code wartości; tablica dla [MULTI]>" }
}

Zasady:
- Dla type=LIST/LIST_MULTIPLE_VALUES: użyj DOKŁADNIE code z listy dozwolonych wartości (nie etykiety).
- Dla [MULTI]: wartość = tablica code.
- Dla type tekstowych/liczbowych: zwykły string.
- Dla type=MEDIA: POMIŃ — nie wypełniaj atrybutów zdjęciowych, zostaną uzupełnione osobno.
- KOLORY (kolor, kolor_siedziska, kolor_obicia, kolor_ramy itp.): ZAWSZE wypełnij na podstawie nazwy produktu, koloru, opisu. Jeśli nazwa zawiera "beżowy", użyj "beżowy". Dobierz DOKŁADNIE jeden code z listy dozwolonych wartości.
- MATERIAŁY (mat_obicia, mat_ramy itp.): ZAWSZE wypełnij z nazwy/opisu. Przykłady: jeśli produkt to sofa tapicerowana tkaniną → mat_obicia="tkanina"; jeśli ma metalowe nogi → mat_ramy="metal"; jeśli drewniana rama → mat_ramy="drewno". Użyj DOKŁADNIE code z listy dozwolonych.
- liczba_sztuk_w_komplecie: ZAWSZE wypełnij — domyślnie "1" jeśli to pojedynczy produkt, lub liczba elementów zestawu. Użyj code z listy (np. "1", "2", "4" itp.).
- Wypełnij KAŻDY atrybut [WYMAGANY] nawet jeśli musisz zgadnąć na podstawie kontekstu. Nie pomijaj wymaganych pól.`;

  const parsed = parseJson<{ description?: string; attributes?: Record<string, string | string[]> }>(await ask(prompt, 3000));
  const attrs = parsed?.attributes || {};
  // Bezpiecznik: doklej lokalne dopasowania, których AI nie zwróciło.
  for (const [code, vals] of Object.entries(hints)) {
    if (attrs[code] == null || attrs[code] === '') {
      const a = attributes.find((x) => x.code === code);
      attrs[code] = a?.multiple ? vals : vals[0];
    }
  }
  return { description: parsed?.description || product.description || '', attributes: attrs };
}

/**
 * Fill a Mirakl offer form (title, description, category attribute values) from product data.
 * Kompozycja osobnych funkcji: tytuł + (opis & parametry) liczone równolegle.
 */
export async function fillMiraklForm(
  product: MebleProduct,
  categoryLabel: string,
  attributes: MarketplaceAttribute[]
): Promise<MiraklFillResult> {
  const [title, filled] = await Promise.all([
    generateMiraklTitle(product, categoryLabel),
    fillMiraklAttributes(product, categoryLabel, attributes),
  ]);
  return { title, description: filled.description, attributes: filled.attributes };
}
