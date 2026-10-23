import OpenAI from 'openai';
import type { MebleProduct } from '@/types';
import type { MarketplaceCategory } from '@/lib/marketplaces/types';
import { prefillKauflandAttributes, isAiFillable, type KauflandAttrSpec } from './prefill';

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
  /** Wartości atrybutów katalogu Kauflandu, kluczowane kodem atrybutu z danej kategorii. */
  attributes: Record<string, string>;
}

/** Sprowadza odpowiedź AI do formatu, jakiego oczekuje dany typ atrybutu Kauflandu. */
function normalizeValue(spec: KauflandAttrSpec, raw: unknown): string {
  const v = String(raw ?? '').trim();
  if (!v || /^(null|brak|nie dotyczy|n\/a|-)$/i.test(v)) return '';
  switch (spec.type) {
    case 'Bool':
      if (/^(true|tak|yes|1)$/i.test(v)) return 'true';
      if (/^(false|nie|no|0)$/i.test(v)) return 'false';
      return '';
    case 'Int': {
      const n = parseInt(v.replace(/[^\d-]/g, ''), 10);
      return Number.isFinite(n) ? String(n) : '';
    }
    case 'Si_Meter':
    case 'Si_Kilogram': {
      const unit = spec.type === 'Si_Meter' ? 'cm' : 'kg';
      const m = v.replace(',', '.').match(/\d+(?:\.\d+)?/);
      return m && Number(m[0]) > 0 ? `${m[0]} ${unit}` : '';
    }
    default:
      return v.slice(0, 1000);
  }
}

/**
 * AI wypełnia ofertę Kaufland: tytuł (note), handling_time, opisy oraz atrybuty katalogu.
 *
 * Lista atrybutów pochodzi ze schematu KATEGORII, nie ze sztywnej listy w kodzie — wcześniej
 * model dostawał osiem pól na zachętę i wszystko poza nimi zostawało puste, choć kategoria ma ich
 * kilkadziesiąt (dla „Narożnika" 34, w tym wymagany `material_composition`). To, co wynika wprost
 * z katalogu, podstawia `prefillKauflandAttributes` i ma pierwszeństwo nad odpowiedzią modelu.
 */
export async function fillKauflandForm(
  product: MebleProduct,
  categoryLabel: string,
  specs: KauflandAttrSpec[] = []
): Promise<KauflandFillResult> {
  const deterministic = prefillKauflandAttributes(product, specs);
  // Model dostaje tylko to, czego sami nie wyliczyliśmy — i nic, czego nie wolno mu zmyślać.
  const askFor = specs.filter((s) => isAiFillable(s) && !deterministic[s.code]);

  const record = {
    name: product.name,
    subtitle: (product as unknown as { subtitle?: string }).subtitle,
    model: product.model,
    kind: product.kind,
    warranty: (product as unknown as { warranty?: string }).warranty,
    attrs: product.attrs || {},
    znane_atrybuty: deterministic,
    description: (product.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 2000),
  };
  const attrList = askFor
    .map((a) => `- "${a.code}" (${a.label}; typ ${a.type}${a.required ? '; WYMAGANY' : ''})`)
    .join('\n');

  const prompt = `Jesteś ekspertem od marketingu mebli. Na podstawie danych produktu wypełnij ofertę Kaufland.
Produkt: ${product.name}
Kategoria: ${categoryLabel}
Dane (JSON): ${JSON.stringify(record, null, 2)}

Zasady dla atrybutów:
- Wypełnij TYLKO te, które wynikają z danych produktu. Czego nie wiesz — wstaw null.
- Nigdy nie zmyślaj liczb, wymiarów ani materiałów. Liczby bierz wyłącznie z danych.
- Bool → true/false. Int → sama liczba. Typ Si_Meter → liczba w cm, Si_Kilogram → liczba w kg.
- Wartości po polsku, bez nazw sklepu, cen, wysyłki i linków.

Atrybuty do wypełnienia:
${attrList || '(brak — wszystkie znane z katalogu)'}

Zwróć TYLKO JSON:
{
  "title": "atrakcyjny tytuł do 120 znaków: nazwa + kluczowe cechy, bez ceny i wysyłki",
  "handling_time": <1-5 dni>,
  "description": "pełny opis do 3000 znaków, czysty tekst bez HTML (Kaufland zabrania linków, zdjęć, cen, informacji o wysyłce i gwarancji): cechy, materiały, zastosowanie, wymiary",
  "short_description": "krótki opis bez HTML do 200 znaków: najważniejsze cechy produktu",
  "attributes": { "kod_atrybutu": "wartość albo null", ... }
}`;

  const parsed = parseJson<{
    title?: string;
    handling_time?: number;
    description?: string;
    short_description?: string;
    attributes?: Record<string, unknown>;
  }>(await ask(prompt, 2000));

  const aiAttrs: Record<string, string> = {};
  const byCode = new Map(askFor.map((s) => [s.code, s]));
  for (const [code, raw] of Object.entries(parsed?.attributes || {})) {
    const spec = byCode.get(code);
    if (!spec) continue; // kod spoza schematu kategorii albo zablokowany — ignorujemy
    const value = normalizeValue(spec, raw);
    if (value) aiAttrs[code] = value;
  }

  return {
    title: parsed?.title || product.name,
    handling_time: Number(parsed?.handling_time) > 0 ? Math.min(5, Number(parsed!.handling_time)) : 1,
    description: parsed?.description || undefined,
    short_description: parsed?.short_description || undefined,
    attributes: { ...aiAttrs, ...deterministic },
  };
}
