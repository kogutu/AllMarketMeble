/**
 * Statyczne listy wartości dla atrybutów, których Mirakl NIE udostępnia przez API
 * (np. Empik `STR_GOLD` „Struktura towarowa GOLD" — typ TEXT, bez listy wartości w `/api/values_lists`).
 *
 * Źródła (w kolejności priorytetu):
 *   1. `data_market/attr_properties.json` — eksport dozwolonych wartości per kod atrybutu.
 *   2. `STATIC_VALUE_LISTS` poniżej — ręczne nadpisania / operator-specyficzne listy.
 *
 * Gdy lista istnieje, atrybut renderuje się jako SELECT (z wyszukiwarką) zamiast pola tekstowego,
 * a publikacja wysyła `code`.
 */
import fs from 'fs';
import { operatorTemplate } from './operatorTemplates';

export interface StaticValue { code: string; label: string }

/** Ręczne nadpisania per operator (mają pierwszeństwo nad attr_properties.json). */
export const STATIC_VALUE_LISTS: Record<string, Record<string, StaticValue[]>> = {
  empik: {},
  brw: {},
};

/**
 * Lazy-loaded, per-operator mapa kod → wartości z pliku `staticValuesPath` operatora
 * (Empik: data_market/empik/attr_properties.json, BRW: data_market/brw/dane_brw.json).
 * Wartości w pliku to zwykłe stringi (code === label). Ładowane raz na operatora, po stronie serwera.
 * Listy ekstremalnie duże (np. słowniki EAN) pomijamy — nie są atrybutami formularza i nie
 * mają sensu jako select wysyłany do klienta.
 */
const MAX_LIST = 20000;
const propsCacheByOperator = new Map<string, Record<string, StaticValue[]>>();

function loadAttrProperties(operator: string): Record<string, StaticValue[]> {
  const cached = propsCacheByOperator.get(operator);
  if (cached) return cached;
  const out: Record<string, StaticValue[]> = {};
  const cfg = operatorTemplate(operator);
  if (cfg) {
    try {
      const raw = JSON.parse(fs.readFileSync(cfg.staticValuesPath, 'utf8')) as Record<string, unknown>;
      for (const [code, list] of Object.entries(raw)) {
        if (!Array.isArray(list) || list.length === 0 || list.length > MAX_LIST) continue;
        out[code] = list
          .map((v) => (typeof v === 'string' ? v : String(v)))
          .map((s) => ({ code: s, label: s }));
      }
    } catch {
      // brak pliku / błąd parsowania — pracujemy bez statycznych list
    }
  }
  propsCacheByOperator.set(operator, out);
  return out;
}

export function getStaticValues(operator: string, attributeCode: string): StaticValue[] {
  const manual = STATIC_VALUE_LISTS[operator]?.[attributeCode];
  if (manual && manual.length) return manual;
  return loadAttrProperties(operator)[attributeCode] ?? [];
}
