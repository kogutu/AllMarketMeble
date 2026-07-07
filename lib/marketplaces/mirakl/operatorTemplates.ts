/**
 * Konfiguracja per-operator dla operatorów Mirakla importujących produkty SZABLONEM XLSX
 * (Empik, BRW). Każdy ma własny: plik szablonu, plik dozwolonych wartości atrybutów, plik pól
 * wymaganych oraz mapowanie pól bazowych (SKU/tytuł/opis/EAN) na kody kolumn swojego szablonu.
 *
 * Kategoria NIE jest osobną kolumną `category` — to atrybut o wartościach-ścieżkach
 * (Empik: STR_GOLD, BRW: pimcore-model-attribute-miraklCategory), wypełniany jak każdy inny atrybut
 * (select + AI), z listą wartości z pliku `staticValuesPath`.
 */
import path from 'path';

const DM = path.join(process.cwd(), 'data_market');

export interface OperatorTemplate {
  /** Ścieżka do pliku szablonu XLSX wysyłanego do operatora. */
  templatePath: string;
  /** Plik z dozwolonymi wartościami atrybutów (kod → lista wartości). */
  staticValuesPath: string;
  /** Plik z polami wymaganymi per kategoria (opcjonalny). */
  requiredPath?: string;
  /** Kody kolumn szablonu dla pól bazowych produktu. */
  fields: { sku: string; title: string; description: string; ean: string };
  /**
   * Format wartości atrybutów LIST w imporcie:
   *  - 'code'  → kod z listy wartości (Empik, np. „AAASR5"),
   *  - 'label' → etykieta z listy wartości (BRW, np. „Biuro", „beżowy").
   */
  valueFormat: 'code' | 'label';
  /** Separator wielu wartości w atrybutach LIST_MULTIPLE_VALUES. */
  multiSep: string;
}

export const OPERATOR_TEMPLATES: Record<string, OperatorTemplate> = {
  empik: {
    templatePath: process.env.EMPIK_TEMPLATE_PATH || path.join(process.cwd(), 'szablon_empik.xlsx'),
    staticValuesPath: path.join(DM, 'empik', 'attr_properties.json'),
    requiredPath: path.join(DM, 'empik', 'wymagane_pola.json'),
    fields: { sku: 'CATALOG_CODE', title: 'PELNY_TYTUL', description: 'OPIS_PRODUKTU_PELNY', ean: 'EAN' },
    // Empik XLSX template oczekuje ETYKIET (nie kodów API Mirakl) — attr_properties.json zawiera etykiety.
    valueFormat: 'label',
    // Standard Mirakl dla wielu wartości w jednej komórce XLSX to | (nie ,).
    multiSep: '|',
  },
  brw: {
    templatePath: process.env.BRW_TEMPLATE_PATH || path.join(DM, 'brw', 'szablon_brw.xlsx'),
    staticValuesPath: path.join(DM, 'brw', 'dane_brw.json'),
    requiredPath: path.join(DM, 'brw', 'brw_req.json'),
    fields: {
      sku: 'product sku',
      title: 'pimcore-model-attribute-name[pl]',
      description: 'pimcore-model-attribute-description[pl]',
      ean: 'pimcore-model-attribute-ean',
    },
    // Import BRW oczekuje ETYKIET (np. „Biuro", „beżowy"), nie kodów listy wartości API (37296).
    // Etykiety bywają z przecinkiem („Salon, jadalnia"), więc separator wielu wartości to `|`, nie `,`.
    valueFormat: 'label',
    multiSep: '|',
  },
};

export function operatorTemplate(operator: string): OperatorTemplate | null {
  return OPERATOR_TEMPLATES[operator] ?? null;
}

export function isTemplateOperator(operator: string): boolean {
  return operatorTemplate(operator) !== null;
}
