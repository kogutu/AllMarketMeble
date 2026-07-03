/**
 * Wypełnianie oficjalnych szablonów importu produktów Mirakla (Empik / BRW).
 *
 * Operatorzy tego typu (Empik, BRW) importują produkty NIE generycznym CSV Mirakla, lecz własnym
 * szablonem XLSX. Arkusz „Data" trzyma w 1. wierszu etykiety, a w 2. wierszu KODY kolumn
 * (STR_GOLD, CATALOG_CODE, PELNY_TYTUL, OPIS_PRODUKTU_PELNY, EAN, VAT_VALUE, 600, 2201, 41, …).
 * NIE ma kolumny `category` — kategorią jest STR_GOLD. Tu wstawiamy nasze rekordy (kluczowane tymi
 * kodami) jako kolejne wiersze danych.
 *
 * Konfiguracja ścieżek szablonów: env EMPIK_TEMPLATE_PATH / BRW_TEMPLATE_PATH. BRW domyślnie korzysta
 * z tego samego szablonu co Empik (ten sam system) — podmień BRW_TEMPLATE_PATH, jeśli różni się kodami.
 */
import fs from 'fs';
import * as XLSX from 'xlsx';
import { operatorTemplate, isTemplateOperator } from './operatorTemplates';

const DATA_SHEET = 'Data';

export { isTemplateOperator };

function templatePathFor(operator: string): string | null {
  return operatorTemplate(operator)?.templatePath ?? null;
}

/**
 * Wczytuje skoroszyt szablonu. Używamy `fs.readFileSync` + `XLSX.read(buffer)` zamiast
 * `XLSX.readFile(path)` — w bundlu Next biblioteka `xlsx` nie ma dostępu do `fs` (jest
 * wycinany), przez co `readFile` rzuca „Cannot access file".
 */
function loadWorkbook(templatePath: string): XLSX.WorkBook {
  const buf = fs.readFileSync(templatePath);
  return XLSX.read(buf, { type: 'buffer' });
}

const headerCache = new Map<string, { labels: unknown[]; codes: string[] }>();

function loadHeader(templatePath: string): { labels: unknown[]; codes: string[] } {
  const cached = headerCache.get(templatePath);
  if (cached) return cached;
  const wb = loadWorkbook(templatePath);
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[DATA_SHEET], { header: 1, defval: '' });
  const header = { labels: aoa[0] ?? [], codes: (aoa[1] ?? []).map((c) => String(c)) };
  headerCache.set(templatePath, header);
  return header;
}

/**
 * Buduje XLSX zgodny z szablonem danego operatora: zachowuje wiersz etykiet + wiersz kodów oraz
 * pozostałe arkusze (ReferenceData/Columns), a poniżej wstawia po jednym wierszu na rekord
 * (wartości mapowane po kodzie kolumny). Zwraca bufor pliku .xlsx.
 */
export function fillMiraklTemplate(operator: string, records: Record<string, string>[]): Buffer {
  const templatePath = templatePathFor(operator);
  if (!templatePath) throw new Error(`No XLSX template configured for operator "${operator}"`);

  // Czytamy świeżo, by zachować arkusze ReferenceData/Columns w nienaruszonej formie.
  const wb = loadWorkbook(templatePath);
  const { labels, codes } = loadHeader(templatePath);

  const rows: unknown[][] = [labels, codes];
  for (const rec of records) {
    rows.push(codes.map((code) => rec[code] ?? ''));
  }

  wb.Sheets[DATA_SHEET] = XLSX.utils.aoa_to_sheet(rows);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Lista kodów kolumn szablonu danego operatora (przydatna do walidacji/mapowania). */
export function templateCodes(operator: string): string[] {
  const templatePath = templatePathFor(operator);
  return templatePath ? loadHeader(templatePath).codes : [];
}
