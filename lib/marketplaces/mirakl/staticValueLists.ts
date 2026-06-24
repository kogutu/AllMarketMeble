/**
 * Statyczne listy wartości dla atrybutów, których Mirakl NIE udostępnia przez API
 * (np. Empik `STR_GOLD` „Struktura towarowa GOLD" — typ TEXT, bez listy wartości w `/api/values_lists`).
 *
 * Klucz: operator (empik|brw) → kod atrybutu → lista { code, label }.
 * Gdy lista istnieje, atrybut renderuje się jako SELECT (zamiast pola tekstowego), a publikacja
 * wysyła `code`. Uzupełnij wartości zgodnie z panelem/dokumentacją Empik/BRW.
 */
export interface StaticValue { code: string; label: string }

export const STATIC_VALUE_LISTS: Record<string, Record<string, StaticValue[]>> = {
  empik: {
    // STR_GOLD — wklej wartości z panelu Empik w formacie { code, label }.
    // np. { code: 'MEBLE_FOTELE', label: 'Meble / Fotele' }
    STR_GOLD: [],
  },
  brw: {},
};

export function getStaticValues(operator: string, attributeCode: string): StaticValue[] {
  return STATIC_VALUE_LISTS[operator]?.[attributeCode] ?? [];
}
