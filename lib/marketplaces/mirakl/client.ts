import axios, { type AxiosInstance } from 'axios';
import { queryOne } from '@/lib/db';
import { cacheGet, cacheSet } from '@/lib/cache';
import logger from '@/lib/logger';
import { getOperator, type MiraklOperator } from './operators';
import { fillMiraklTemplate, isTemplateOperator } from './empikTemplate';
import { operatorTemplate } from './operatorTemplates';

/**
 * Generic Mirakl client. One implementation drives every Mirakl operator (Empik + future ones);
 * only credentials/base URL differ. Mirakl uses a static API key (Authorization header) and
 * asynchronous, tracked imports for products and offers (each returns an import_id to poll).
 *
 * NOTE (Krok 0): exact endpoint flavors vary per operator (CSV PM01 vs JSON; OF01 vs OF24).
 * The endpoint paths are centralized here so they can be confirmed/adjusted against Empik's
 * seller documentation without touching the adapter/feed layers.
 */

export interface MiraklCredentials {
  baseUrl: string;
  apiKey: string;
}

/** Resolve credentials: DB account override (allegro_tokens) first, then operator env vars. */
export async function resolveMiraklCredentials(
  operatorId: string,
  accountId?: string
): Promise<MiraklCredentials> {
  const operator = getOperator(operatorId);
  if (!operator) throw new Error(`Unknown Mirakl operator: ${operatorId}`);

  const row = accountId
    ? await queryOne<{ api_key: string | null; base_url: string | null }>(
        `SELECT api_key, base_url FROM allegro_tokens
         WHERE account_id = ? AND marketplace = 'mirakl' LIMIT 1`,
        [accountId]
      )
    : null;

  const baseUrl = row?.base_url || process.env[operator.baseUrlEnv] || operator.defaultBaseUrl;
  const apiKey = row?.api_key || process.env[operator.apiKeyEnv];

  if (!baseUrl) throw new Error(`No base URL for Mirakl operator ${operatorId} (set ${operator.baseUrlEnv})`);
  if (!apiKey) throw new Error(`No API key for Mirakl operator ${operatorId} (set ${operator.apiKeyEnv} or add account)`);

  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey };
}

function miraklApi(creds: MiraklCredentials): AxiosInstance {
  return axios.create({
    baseURL: creds.baseUrl,
    headers: { Authorization: creds.apiKey, Accept: 'application/json' },
    timeout: 30000,
  });
}

// ── Endpoint paths (adjust per operator after Krok 0) ───────────────────────
const EP = {
  hierarchies: '/api/hierarchies',
  attributes: '/api/products/attributes',
  valuesLists: '/api/values_lists',
  productImports: '/api/products/imports',
  productImport: (id: string) => `/api/products/imports/${id}`,
  offers: '/api/offers',                 // OF24 (POST JSON) + OF21 (GET list)
  offerImports: '/api/offers/imports',   // OF01 (POST plik CSV/XML)
  offerImport: (id: string) => `/api/offers/imports/${id}`,
};

export class MiraklClient {
  private api: AxiosInstance;
  constructor(readonly operator: MiraklOperator, creds: MiraklCredentials) {
    this.api = miraklApi(creds);
  }

  static async forOperator(operatorId: string, accountId?: string): Promise<MiraklClient> {
    const operator = getOperator(operatorId);
    if (!operator) throw new Error(`Unknown Mirakl operator: ${operatorId}`);
    const creds = await resolveMiraklCredentials(operatorId, accountId);
    return new MiraklClient(operator, creds);
  }

  // ── Catalog ──────────────────────────────────────────────────────────────
  async getHierarchies(): Promise<unknown[]> {
    const key = `mirakl:${this.operator.id}:hierarchies`;
    const cached = cacheGet<unknown[]>(key);
    if (cached) return cached;
    const res = await this.api.get(EP.hierarchies);
    const result = (res.data?.hierarchies ?? res.data ?? []) as unknown[];
    cacheSet(key, result);
    return result;
  }

  async getAttributes(hierarchyCode?: string): Promise<unknown[]> {
    const key = `mirakl:${this.operator.id}:attrs:${hierarchyCode ?? 'all'}`;
    const cached = cacheGet<unknown[]>(key);
    if (cached) return cached;
    // Paginate — some operators (BRW) return >1000 attributes including classificationstore ones.
    const PAGE = 500;
    const all: unknown[] = [];
    let offset = 0;
    while (true) {
      const res = await this.api.get(EP.attributes, {
        params: { ...(hierarchyCode ? { hierarchy: hierarchyCode } : {}), max: PAGE, offset },
      });
      const page = (res.data?.attributes ?? res.data ?? []) as unknown[];
      all.push(...page);
      if (page.length < PAGE) break;
      offset += PAGE;
    }
    cacheSet(key, all);
    return all;
  }

  async getValuesList(code: string): Promise<{ code: string; label: string }[]> {
    const key = `mirakl:${this.operator.id}:vl:${code}`;
    const cached = cacheGet<{ code: string; label: string }[]>(key);
    if (cached) return cached;
    // NOTE: Empik filters by `code` (fast, single list). `values_list_ids` is IGNORED and
    // returns the entire ~1100-list catalog (~12s), so do not use it.
    const res = await this.api.get(EP.valuesLists, { params: { code } });
    const lists = (res.data?.values_lists ?? []) as { code: string; values?: { code: string; label: string }[] }[];
    const all = (lists.find((l) => l.code === code) ?? lists[0])?.values ?? [];
    // Some Empik value lists have 50k–100k+ entries (e.g. brands/producers). Cap to keep payload/memory
    // sane — a dropdown of that size is unusable anyway; AI fill trims further on its side.
    let values = all.slice(0, 500);
    // …ale niektóre potrzebne wpisy (np. nasz producent „Mebel-Partner") leżą poza pierwszymi 500
    // w olbrzymiej liście marek → select pokazywał pusto. Doklejamy z przodu wpisy pasujące do
    // skonfigurowanego domyślnego producenta, żeby zawsze były dostępne do wyboru.
    const mustInclude = process.env.DEFAULT_PRODUCENT_MARKA
      || process.env.NEXT_PUBLIC_DEFAULT_PRODUCENT_MARKA
      || 'Mebel-Partner';
    if (mustInclude && all.length > values.length) {
      const needle = mustInclude.toLowerCase().replace(/[\s-]+/g, '');
      const have = new Set(values.map((v) => v.code));
      const extra = all.filter((v) => {
        const hay = `${v.label} ${v.code}`.toLowerCase().replace(/[\s-]+/g, '');
        return hay.includes(needle) && !have.has(v.code);
      });
      if (extra.length) values = [...extra, ...values];
    }
    cacheSet(key, values);
    return values;
  }

  // ── Product import (async) ─────────────────────────────────────────────────
  /** Submit a product feed (array of {column->value} records). Returns import_id. */
  async importProducts(records: Record<string, string>[]): Promise<string> {
    const form = new FormData();
    if (isTemplateOperator(this.operator.id)) {
      // Empik/BRW przyjmują import wyłącznie swoim szablonem XLSX (a nie generycznym CSV Mirakla).
      const xlsx = fillMiraklTemplate(this.operator.id, records);
      // Nazwa pliku = EAN/GTIN produktu (kody pól zależne od operatora; fallback SKU / „products").
      const tpl = operatorTemplate(this.operator.id);
      const ean = (tpl && (records[0]?.[tpl.fields.ean] || records[0]?.[tpl.fields.sku])) || 'products';
      const fileName = `${String(ean).replace(/[^0-9A-Za-z._-]/g, '')}.xlsx`;
      form.append('file', new Blob([new Uint8Array(xlsx)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }), fileName);
    } else {
      const csv = recordsToCsv(records);
      form.append('file', new Blob([csv], { type: 'text/csv' }), 'products.csv');
    }
    form.append('import_mode', 'NORMAL');
    const res = await this.api.post(EP.productImports, form);
    const importId = String(res.data?.import_id ?? res.data?.product_import_id ?? '');
    logger.info('mirakl importProducts', { operator: this.operator.id, importId });
    return importId;
  }

  async getProductImportStatus(importId: string): Promise<{ status: string; hasErrorReport: boolean; raw: unknown }> {
    const res = await this.api.get(EP.productImport(importId));
    return {
      status: String(res.data?.import_status ?? res.data?.status ?? 'WAITING'),
      hasErrorReport: Boolean(res.data?.has_error_report),
      raw: res.data,
    };
  }

  // ── Offer import (OF24 JSON, async) ────────────────────────────────────────
  /** Submit offers as JSON (OF24). Returns import_id. */
  async importOffers(offers: Record<string, unknown>[]): Promise<string> {
    const res = await this.api.post(EP.offers, { offers });
    const importId = String(res.data?.import_id ?? '');
    logger.info('mirakl importOffers', { operator: this.operator.id, importId });
    return importId;
  }

  /** Withdraw (delete) an offer from the marketplace by shop_sku (OF24 update_delete=delete). */
  async withdrawOffer(shopSku: string): Promise<string> {
    return this.importOffers([{ shop_sku: shopSku, update_delete: 'delete' }]);
  }

  /** Import ofert z pliku XML (OF01) — feed w formacie Mirakla `<import><offers>…`. Zwraca import_id. */
  async importOffersXml(xml: string): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([xml], { type: 'application/xml' }), 'offers.xml');
    form.append('import_mode', 'NORMAL');
    const res = await this.api.post(EP.offerImports, form);
    const importId = String(res.data?.import_id ?? res.data?.offer_import_id ?? '');
    logger.info('mirakl importOffersXml', { operator: this.operator.id, importId, bytes: xml.length });
    return importId;
  }

  async getOfferImportStatus(importId: string): Promise<{ status: string; hasErrorReport: boolean; raw: unknown }> {
    const res = await this.api.get(EP.offerImport(importId));
    return {
      status: String(res.data?.import_status ?? res.data?.status ?? 'WAITING'),
      hasErrorReport: Boolean(res.data?.has_error_report),
      raw: res.data,
    };
  }

  private async getReportText(url: string): Promise<string> {
    const res = await this.api.get(url, { responseType: 'text', headers: { Accept: '*/*' } });
    return String(res.data ?? '');
  }

  /**
   * Human-readable errors for a product import (PM transformation/import error report).
   * Returns the value of the `errors` column for each failed line (e.g. "1004|The category…").
   */
  async getProductImportErrors(importId: string): Promise<string[]> {
    const status = await this.getProductImportStatus(importId);
    const raw = status.raw as { has_transformation_error_report?: boolean; has_error_report?: boolean };
    const url = raw?.has_transformation_error_report
      ? `${EP.productImport(importId)}/transformation_error_report`
      : raw?.has_error_report ? `${EP.productImport(importId)}/error_report` : null;
    if (!url) return [];
    return extractReportColumn(await this.getReportText(url).catch(() => ''), ['errors', 'error', 'error-message']);
  }

  /** Human-readable errors for an offer import (OF error report `error-message` column). */
  async getOfferImportErrors(importId: string): Promise<string[]> {
    const status = await this.getOfferImportStatus(importId);
    if (!(status.raw as { has_error_report?: boolean })?.has_error_report) return [];
    const url = `${EP.offerImport(importId)}/error_report`;
    return extractReportColumn(await this.getReportText(url).catch(() => ''), ['error-message', 'errors', 'error']);
  }

  /** Fetch a live offer by shop_sku (OF21). */
  async getOfferBySku(shopSku: string): Promise<unknown | null> {
    const res = await this.api.get(EP.offers, { params: { shop_skus: shopSku } });
    const offers = (res.data?.offers ?? []) as unknown[];
    return offers[0] ?? null;
  }

  /** List the shop's live offers (OF21), paginated. */
  async getOffers(offset = 0, max = 100): Promise<{ offers: Record<string, unknown>[]; total: number }> {
    const res = await this.getWithRetry(EP.offers, { offset, max });
    return { offers: (res?.offers ?? []) as Record<string, unknown>[], total: Number(res?.total_count ?? 0) };
  }

  /** GET with exponential backoff on 429 (Empik rate-limits bursts). */
  private async getWithRetry(url: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        return (await this.api.get(url, { params })).data;
      } catch (e) {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 429 && attempt < 5) { await sleep(2000 * (attempt + 1)); continue; }
        throw e;
      }
    }
    return {};
  }
}

/**
 * Extract one column (by candidate header names, else the last column) from a Mirakl error report
 * (fully `"`-quoted, `;`-separated). Returns non-empty cell values from the data rows.
 */
function extractReportColumn(csv: string, headerCandidates: string[]): string[] {
  if (!csv.trim()) return [];
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const parseRow = (line: string) => line.replace(/^"/, '').replace(/"$/, '').split('";"');
  const header = parseRow(lines[0]).map((h) => h.toLowerCase().trim());
  let idx = -1;
  for (const cand of headerCandidates) { idx = header.indexOf(cand); if (idx >= 0) break; }
  if (idx < 0) idx = header.length - 1;
  const out: string[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseRow(line);
    const v = (cells[idx] ?? '').trim();
    if (v) out.push(v);
  }
  return out;
}

/** Build a `;`-separated CSV (Mirakl default) from record objects keyed by column code. */
function recordsToCsv(records: Record<string, string>[]): string {
  if (records.length === 0) return '';
  const columns = Array.from(new Set(records.flatMap((r) => Object.keys(r))));
  const escape = (v: string) => {
    const s = v ?? '';
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.join(';');
  const lines = records.map((r) => columns.map((c) => escape(r[c] ?? '')).join(';'));
  return [header, ...lines].join('\n');
}
