import type { MebleProduct } from '@/types';

/** Atrybut kategorii Kauflandu w postaci, w jakiej oddaje go `/api/kaufland/categories/{id}/attributes`. */
export interface KauflandAttrSpec {
  code: string;
  label: string;
  type: string;
  required?: boolean;
}

/**
 * Typy, których nie wolno wypełniać automatem: to pliki, media i deklaracje zgodności. Zmyślony
 * link do karty charakterystyki albo wpisana „na oko" osoba odpowiedzialna za UE są gorsze niż
 * puste pole — Kaufland i tak je odrzuci, a odpowiedzialność prawna zostaje po naszej stronie.
 */
const NON_INFERABLE_TYPES = new Set([
  'Picture', 'Video', 'Document', 'RichContent', 'ComplianceContact', 'Category', 'Url',
  // Bool to twierdzenie o produkcie bez miejsca na „nie wiem" — model wpisywał tu `true`
  // (np. zdejmowane pokrycie) tam, gdzie katalog milczy. Wypełniamy je wyłącznie z danych.
  'Bool',
]);

/** Pola, które mimo tekstowego typu wypełnia człowiek albo osobne API (GPSR, numery wewnętrzne). */
const NON_INFERABLE_CODES = new Set([
  'real_mgb_artnum',                // numer zamówienia internetowego Kauflandu
  'chem_verbots_v_relevance',       // deklaracja prawna
  'battery_disposal_instruction',   // deklaracja prawna (BattG)
  'product_safety_contact',         // GPSR — ustawiany przez /contacts/products/{ean}
]);

/** Czy atrybut nadaje się do wypełnienia przez AI. */
export const isAiFillable = (spec: KauflandAttrSpec): boolean =>
  !NON_INFERABLE_TYPES.has(spec.type) && !NON_INFERABLE_CODES.has(spec.code);

const deaccent = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L');

/** Klucze atrybutów bywają z polskimi znakami i bez — porównujemy po znormalizowanej formie. */
const normKey = (s: string): string => deaccent(s).toLowerCase().replace(/\s+/g, '_');

const firstNumber = (v: string): string => {
  const m = v.replace(',', '.').match(/\d+(?:\.\d+)?/);
  return m ? m[0] : '';
};

const withUnit = (v: string, unit: string): string => {
  if (!v) return '';
  if (new RegExp(`${unit}\s*$`, 'i').test(v)) return v;
  const n = firstNumber(v);
  return n && Number(n) > 0 ? `${n} ${unit}` : '';
};

/**
 * Cecha boolowska z opisu produktu. Brak wzmianki znaczy „nie wiem", nie „nie" — puste pole jest
 * uczciwsze niż zaprzeczenie, którego katalog nie potwierdza.
 */
const boolFromFeatures = (index: Map<string, string>, pattern: RegExp): string => {
  let found = false;
  index.forEach((value) => {
    if (pattern.test(value)) found = true;
  });
  return found ? 'true' : '';
};

/** Płaski indeks wszystkich wartości opisowych produktu, po znormalizowanym kluczu. */
const indexProduct = (product: MebleProduct): Map<string, string> => {
  const index = new Map<string, string>();
  const put = (key: string, raw: unknown) => {
    const val = Array.isArray(raw)
      ? raw.filter(Boolean).map(String).join(', ')
      : raw == null ? '' : String(raw);
    const trimmed = val.trim();
    if (!trimmed || trimmed === '0' || index.has(normKey(key))) return;
    index.set(normKey(key), trimmed);
  };
  for (const [k, v] of Object.entries((product.attrs || {}) as Record<string, unknown>)) put(k, v);
  const char = (product as unknown as { charakterystyka?: Record<string, unknown>[] }).charakterystyka?.[0];
  for (const [k, v] of Object.entries(char || {})) put(k, v);
  return index;
};

/**
 * Deterministyczne wypełnienie atrybutów Kauflandu z danych produktu — jedno źródło prawdy dla
 * formularza i dodawania masowego. To, co wynika wprost z katalogu (wymiary, kolor, materiały,
 * instrukcja), bierzemy stąd, a nie od AI: model potrafi pomylić liczby, których nie musi zgadywać.
 */
export function prefillKauflandAttributes(
  product: MebleProduct,
  specs: KauflandAttrSpec[],
): Record<string, string> {
  const index = indexProduct(product);
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = index.get(normKey(k));
      if (v) return v;
    }
    return '';
  };
  const url = (...keys: string[]): string => {
    const v = pick(...keys) || String((product as unknown as Record<string, unknown>)[keys[0]] ?? '');
    return /^https?:\/\//i.test(v) ? v : '';
  };

  const width = pick('szerokość', 'szerokosc');
  const height = pick('wysokość', 'wysokosc');
  const depth = pick('głębokość', 'glebokosc', 'długość', 'dlugosc');
  const weight = pick('waga_produktu_kg', 'waga');

  // Skład materiału jest atrybutem WYMAGANYM — sklejamy go z tego, co katalog podaje osobno.
  const parts = [
    ['obicie', pick('materiał_obicia', 'material_obicia', 'tkanina')],
    ['wypełnienie', pick('materiał_wypełnienia_korpusu', 'material_wypelnienia_korpusu', 'materiał_wypełnienia')],
    ['nóżki', pick('materiał_nóżek', 'material_nozek', 'materiał_podstawy', 'material_podstawy')],
    ['korpus', pick('materiał_korpusu', 'material_korpusu', 'materiał_blatu', 'material_blatu')],
  ].filter(([, v]) => v);
  const composition = parts.map(([k, v]) => `${k}: ${v}`).join('; ');

  const byCode: Record<string, string> = {
    manufacturer: product.brand || process.env.NEXT_PUBLIC_DEFAULT_PRODUCENT_MARKA || 'Mebel Partner',
    mpn: product.sku || String(product.id),
    model: product.model || '',
    colour: pick('kolor_korpusu', 'kolor_siedziska', 'kolor_blatu', 'kolor', 'kolor_podstawy') || product.color?.name || '',
    material: pick('materiał_obicia', 'material_obicia', 'tkanina', 'materiał_blatu', 'material_blatu', 'materiał', 'material'),
    material_composition: composition,
    wood_type: pick('rodzaj_drewna', 'materiał_nóżek', 'material_nozek', 'materiał_podstawy', 'material_podstawy'),
    width: withUnit(width, 'cm'),
    height: withUnit(height, 'cm'),
    depth: withUnit(depth, 'cm'),
    length: withUnit(pick('długość', 'dlugosc'), 'cm'),
    weight: withUnit(weight, 'kg'),
    persons_count_max: firstNumber(pick('ilość_pól_siedzących', 'ilosc_pol_siedzacych', 'liczba_miejsc')),
    product_dimensions:
      width && depth && height
        ? `${firstNumber(width)} × ${firstNumber(depth)} × ${firstNumber(height)} cm`
        : '',
    manual: url('instrukcja_uzytkowania', 'instrukcja_obslugi'),
    removable_cover: boolFromFeatures(index, /zdejmowan|zdejmowane pokrycie|zdejmowany pokrowiec/i),
  };

  const allowed = new Set(specs.map((s) => s.code));
  const out: Record<string, string> = {};
  for (const [code, value] of Object.entries(byCode)) {
    if (allowed.has(code) && value) out[code] = value;
  }
  return out;
}
