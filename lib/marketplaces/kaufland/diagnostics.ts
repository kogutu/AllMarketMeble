import type { KauflandProductDataStatus } from './client';

/**
 * Tłumaczenie werdyktu Kauflandu na konkretne „co zrobić”.
 *
 * Kaufland raportuje braki po niemiecku (`missing_attributes: ["Titel","Beschreibung","Bild"]`),
 * a powody odrzuceń jako surowe kody (`media_not_ready_yet`, `wrong_language_and_missing_offer`).
 * Tu zamieniamy jedno i drugie na polskie komunikaty, których można użyć wprost.
 */

/** Nazwy atrybutów tak, jak zwraca je Kaufland (DE w `missing`, EN w `attribute_values`). */
const ATTR_PL: Record<string, string> = {
  Titel: 'tytuł',
  Beschreibung: 'opis',
  Bild: 'zdjęcie',
  Hersteller: 'producent',
  Kategorie: 'kategoria',
  EAN: 'EAN',
  title: 'tytuł',
  description: 'opis',
  short_description: 'krótki opis',
  picture: 'zdjęcia',
  manufacturer: 'producent',
  category: 'kategoria',
  colour: 'kolor',
  material: 'materiał',
  wood_type: 'rodzaj drewna',
};

export const attrPl = (name: string): string => ATTR_PL[name] ?? name;

/** Główne kategorie powodów, dla których oferta nie dociera do klientów. */
export const PROBLEM_KIND = {
  DATA: 'Dane produktowe',
  ONHOLD: 'Wstrzymana',
  STOCK: 'Stan 0',
  TITLE: 'Bez tytułu',
  OTHER: 'Inne',
} as const;

/** Powód odrzucenia atrybutu → instrukcja. Zwraca `null`, gdy kodu nie znamy. */
function explainReason(message: string): string | null {
  if (message.includes('wrong_language')) return 'tekst w języku innym niż locale oferty — wyślij dane ponownie (poprawka locale)';
  if (message.includes('media_not_ready_yet')) return 'Kaufland nie pobrał jeszcze pliku — wyślij dane ponownie i sprawdź za kilka godzin';
  if (message.includes('missing_offer')) return 'brak oferty w tym kanale sprzedaży';
  if (message.includes('invalid_value')) return 'wartość w formacie, którego Kaufland nie przyjmuje';
  if (message.includes('invalid_range')) return 'wartość poza dopuszczalnym zakresem';
  return null;
}

/**
 * Atrybuty, które faktycznie wysyłamy. Kaufland raportuje też odrzucenia atrybutów pochodzących
 * z własnych reguł i od innych sprzedawców (`list_price`, `real_mgb_artnum`, `additional_categories`…)
 * — pokazywanie ich jako „naszych problemów” byłoby myleniem obsługi.
 */
const OUR_ATTRS = new Set([
  'title', 'description', 'short_description', 'picture', 'category', 'manufacturer', 'mpn',
  'colour', 'material', 'wood_type', 'width', 'height', 'depth', 'length', 'weight',
  'form', 'surface_style', 'suitable_for_location', 'model', 'product_dimensions',
  'package_included', 'extendable', 'foldable',
]);

/**
 * Lista problemów do wyświetlenia przy ofercie — każdy wiersz to jedna rzecz do zrobienia.
 * `gpsr === null` znaczy „nie sprawdzano”, więc nie dopisujemy wtedy ostrzeżenia o GPSR.
 */
export function problemList(st: KauflandProductDataStatus | null, gpsr: boolean | null): string[] {
  const out: string[] = [];
  if (!st) {
    out.push('Brak danych produktowych — nigdy ich nie wysłano dla tego EAN-u');
    if (gpsr === false) out.push('Brak kontaktu GPSR');
    return out;
  }

  if (st.status === 'FAIL') out.push(`Kaufland odrzucił dane: ${st.failReason ?? 'bez podanego powodu'}`);
  if (st.blocked.length) out.push(`Produkt zablokowany: ${st.blocked.join(', ')}`);
  if (st.missing.length) out.push(`Brakuje: ${st.missing.map(attrPl).join(', ')}`);

  if (st.pictures.total === 0) out.push('Brak zdjęć w katalogu Kauflandu');
  else if (st.pictures.rejected > 0) out.push(`Odrzucone zdjęcia: ${st.pictures.rejected} z ${st.pictures.total}`);

  // Powody per atrybut — tylko te, które sami wysyłamy, i bez duplikatów (Kaufland powtarza
  // ten sam kod przy każdym zdjęciu).
  const seen = new Set<string>();
  let foreign = 0;
  for (const d of st.declined) {
    if (!OUR_ATTRS.has(d.attribute)) { foreign += 1; continue; }
    const why = explainReason(d.message);
    const line = why ? `${attrPl(d.attribute)}: ${why}` : `${attrPl(d.attribute)}: ${d.state}${d.message ? ` (${d.message})` : ''}`;
    if (!seen.has(line)) { seen.add(line); out.push(line); }
  }
  if (foreign > 0) out.push(`${foreign} odrzuconych atrybutów spoza naszego zestawu (reguły Kauflandu / dane innych sprzedawców)`);

  if (gpsr === false) out.push('Brak kontaktu GPSR — Seller Center poprosi o ręczne wpisanie danych producenta');
  if (out.length === 0 && !st.ready) out.push(`Niegotowy: ${st.notReadyReason ?? st.status}`);
  return out;
}

/** Jednolinijkowe podsumowanie do kolumny w siatce ofert. */
export function describeProductData(st: KauflandProductDataStatus | null): string {
  if (!st) return 'brak danych produktowych';
  if (st.status === 'FAIL') return `odrzucone: ${st.failReason ?? 'bez powodu'}`;
  const parts: string[] = [];
  if (st.blocked.length) parts.push(`zablokowany: ${st.blocked.join(', ')}`);
  if (st.missing.length) parts.push(`brakuje: ${st.missing.map(attrPl).join(', ')}`);
  if (st.pictures.rejected > 0) parts.push(`zdjęcia odrzucone ${st.pictures.rejected}/${st.pictures.total}`);
  else if (st.pictures.total === 0) parts.push('brak zdjęć');
  if (st.declined.some((d) => d.message.includes('wrong_language'))) parts.push('tekst w złym języku');
  if (parts.length === 0) return st.ready ? 'OK' : `niegotowy: ${st.notReadyReason ?? st.status}`;
  return parts.join(' • ');
}
