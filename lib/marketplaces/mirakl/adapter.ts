import { MiraklClient } from './client';
import { buildProductRecord, buildOfferRecord, findMissingAttributes } from './feed';
import { getStaticValues } from './staticValueLists';
import type {
  MarketplaceAdapter,
  MarketplaceCategory,
  MarketplaceAttribute,
  OfferDraft,
  PublishOutcome,
  LiveStatus,
  LiveOfferRow,
  LiveOffersAdapter,
} from '@/lib/marketplaces/types';
import type { MiraklFormData } from '@/types';

export type { LiveOfferRow };

interface RawHierarchy {
  code: string;
  label: string;
  parent_code?: string | null;
}

interface RawAttribute {
  code: string;
  label?: string;
  type?: string;
  required?: boolean;
  type_parameter?: string;   // value list code for LIST types
  type_parameters?: { values_list_id?: string };
}

const LIST_TYPES = new Set(['LIST', 'LIST_MULTIPLE_VALUES']);

function importDone(status: string): boolean {
  return ['COMPLETE', 'FINISHED', 'COMPLETED'].includes(status.toUpperCase());
}

/**
 * Generic Mirakl adapter — one class serves every Mirakl operator (Empik + future ones).
 * Implements the "product + offer" model: publish submits a product import and an offer import,
 * both tracked asynchronously; final status is resolved via syncStatus.
 */
export class MiraklAdapter implements MarketplaceAdapter, LiveOffersAdapter {
  readonly kind = 'mirakl' as const;
  constructor(
    readonly accountId: string,
    readonly operator: string,
    private client: MiraklClient
  ) {}

  static async create(operator: string, accountId: string): Promise<MiraklAdapter> {
    const client = await MiraklClient.forOperator(operator, accountId);
    return new MiraklAdapter(accountId, operator, client);
  }

  async getCategories(parentCode?: string): Promise<MarketplaceCategory[]> {
    const raw = (await this.client.getHierarchies()) as RawHierarchy[];
    const parents = new Set(raw.map((h) => h.parent_code).filter(Boolean) as string[]);
    return raw
      .filter((h) => (parentCode ? h.parent_code === parentCode : !h.parent_code))
      .map((h) => ({ code: h.code, label: h.label, parentCode: h.parent_code ?? null, leaf: !parents.has(h.code) }));
  }

  /** Full normalized category list (for local scoring/matching). */
  async listCategories(): Promise<MarketplaceCategory[]> {
    const raw = (await this.client.getHierarchies()) as RawHierarchy[];
    const parents = new Set(raw.map((h) => h.parent_code).filter(Boolean) as string[]);
    return raw.map((h) => ({ code: h.code, label: h.label, parentCode: h.parent_code ?? null, leaf: !parents.has(h.code) }));
  }

  async searchCategories(phrase: string): Promise<MarketplaceCategory[]> {
    const raw = (await this.client.getHierarchies()) as RawHierarchy[];
    const parents = new Set(raw.map((h) => h.parent_code).filter(Boolean) as string[]);
    const p = phrase.toLowerCase();
    return raw
      .filter((h) => h.label?.toLowerCase().includes(p) || h.code?.toLowerCase().includes(p))
      .map((h) => ({ code: h.code, label: h.label, parentCode: h.parent_code ?? null, leaf: !parents.has(h.code) }));
  }

  async getCategoryAttributes(categoryCode: string): Promise<MarketplaceAttribute[]> {
    const raw = (await this.client.getAttributes(categoryCode)) as RawAttribute[];
    // Fetch all needed value lists in parallel (sequential fetch is the main slowness source).
    return Promise.all(
      raw.map(async (a): Promise<MarketplaceAttribute> => {
        const type = a.type ?? 'TEXT';
        const attr: MarketplaceAttribute = {
          code: a.code,
          label: a.label ?? a.code,
          type,
          required: Boolean(a.required),
          multiple: type === 'LIST_MULTIPLE_VALUES',
        };
        const vlCode = a.type_parameter ?? a.type_parameters?.values_list_id;
        if (LIST_TYPES.has(type) && vlCode) {
          attr.values = await this.client.getValuesList(vlCode).catch(() => []);
        }
        // Atrybuty bez listy w API (np. STR_GOLD) — uzupełnij ze statycznej konfiguracji,
        // żeby renderowały się jako SELECT zamiast pola tekstowego.
        if (!attr.values || attr.values.length === 0) {
          const stat = getStaticValues(this.operator, a.code);
          if (stat.length) attr.values = stat;
        }
        return attr;
      })
    );
  }

  async publish(draft: OfferDraft): Promise<PublishOutcome> {
    const form = draft.formData as unknown as MiraklFormData;

    // Validate required attributes before submitting (clear error instead of a rejected import).
    const attrs = await this.getCategoryAttributes(form.categoryCode);
    const productRecord = await buildProductRecord(this.operator, draft.product ?? null, form);
    const missing = findMissingAttributes(
      attrs.map((a) => ({ code: a.code, required: a.required })),
      productRecord
    );
    if (missing.length > 0) {
      return { ref: form.sku, status: 'error', raw: { missingAttributes: missing } };
    }

    const productImportId = await this.client.importProducts([productRecord]);

    const price = Number(form.price ?? draft.basePrice ?? 0);
    const offerRecord = buildOfferRecord(form, price);
    const offerImportId = await this.client.importOffers([offerRecord]);

    return { ref: form.sku, productImportId, offerImportId, status: 'pending' };
  }

  /** List live shop offers (real marketplace data) for the comparison view. */
  async listLiveOffers(offset = 0, max = 100): Promise<{ total: number; offers: LiveOfferRow[] }> {
    const { offers, total } = await this.client.getOffers(offset, max);
    return {
      total,
      offers: offers.map((o): LiveOfferRow => {
        const refs = (o.product_references as { reference: string; reference_type: string }[] | undefined) || [];
        return {
          ref: String(o.shop_sku ?? ''),
          offerId: o.offer_id != null ? String(o.offer_id) : null,
          title: (o.product_title as string) ?? null,
          ean: refs.find((r) => r.reference_type === 'EAN')?.reference ?? null,
          sku: String(o.shop_sku ?? ''),
          price: o.price != null ? Number(o.price) : (o.total_price != null ? Number(o.total_price) : null),
          quantity: o.quantity != null ? Number(o.quantity) : null,
          state: o.active === false ? 'inactive' : 'active',
          stateCode: (o.state_code as string) ?? '11',
          leadtime: o.leadtime_to_ship != null ? Number(o.leadtime_to_ship) : undefined,
          logisticClass: (o.logistic_class as { code?: string } | undefined)?.code,
          category: (o.category_label as string) ?? null,
          raw: o,
        };
      }),
    };
  }

  /**
   * Build an index of all live offers keyed by EAN (OF21 server-side filtering is unavailable
   * on this operator, so we page through everything). Result is cached by the caller.
   */
  async getAllEanIndex(): Promise<Record<string, { active: boolean; sku: string }>> {
    const index: Record<string, { active: boolean; sku: string }> = {};
    const addPage = (offers: Record<string, unknown>[]) => {
      for (const o of offers) {
        const refs = (o.product_references as { reference: string; reference_type: string }[] | undefined) || [];
        const ean = refs.find((r) => r.reference_type === 'EAN')?.reference;
        if (ean) index[String(ean)] = { active: o.active !== false, sku: String(o.shop_sku ?? '') };
      }
    };

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // Gentle sequential paging with retry — Empik rate-limits parallel bursts (429).
    const fetchPage = async (offset: number): Promise<{ offers: Record<string, unknown>[]; total: number }> => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await this.client.getOffers(offset, 100);
        } catch (e) {
          const status = (e as { response?: { status?: number } })?.response?.status;
          if (status === 429 && attempt < 4) { await sleep(2000 * (attempt + 1)); continue; }
          throw e;
        }
      }
      return { offers: [], total: 0 };
    };

    const first = await fetchPage(0);
    addPage(first.offers);
    for (let off = 100; off < first.total; off += 100) {
      const page = await fetchPage(off);
      addPage(page.offers);
      await sleep(150);
    }
    return index;
  }

  /** Live offer values on Empik by shop_sku (for comparison views). */
  async getLiveOffer(shopSku: string): Promise<{ price: number | null; quantity: number | null; status: string }> {
    const o = (await this.client.getOfferBySku(shopSku).catch(() => null)) as
      | { price?: number; total_price?: number; quantity?: number; active?: boolean }
      | null;
    if (!o) return { price: null, quantity: null, status: 'unknown' };
    return {
      price: o.price ?? o.total_price ?? null,
      quantity: o.quantity ?? null,
      status: o.active === false ? 'inactive' : 'active',
    };
  }

  async updateLive(_ref: string, draft: OfferDraft): Promise<void> {
    // Mirakl imports are upserts — re-publishing updates the existing product/offer.
    await this.publish(draft);
  }

  /** Offer-only update (price/quantity) — submits an OF24 offer import. Returns import id. */
  async pushOffer(form: MiraklFormData, price: number, quantity: number): Promise<string> {
    const record = buildOfferRecord({ ...form, quantity }, price);
    return this.client.importOffers([record]);
  }

  /** Update price/quantity of an existing live offer identified by shop_sku (no local draft needed). */
  async updateOfferByRef(
    row: { ref: string; ean?: string | null; stateCode?: string; leadtime?: number; logisticClass?: string },
    price: number,
    quantity: number
  ): Promise<string> {
    const record: Record<string, unknown> = {
      shop_sku: row.ref,
      product_id: row.ean || undefined,
      product_id_type: row.ean ? 'EAN' : undefined,
      price,
      quantity,
      state_code: row.stateCode || '11',
      logistic_class: row.logisticClass || undefined,
      leadtime_to_ship: row.leadtime ?? undefined,
      update_delete: 'update',
    };
    return this.client.importOffers([record]);
  }

  /** Withdraw the offer from the marketplace by shop_sku (OF24 update_delete=delete). */
  async withdraw(ref: string): Promise<string> {
    return this.client.withdrawOffer(ref);
  }

  async syncStatus(
    ref: string,
    extra?: { productImportId?: string; offerImportId?: string }
  ): Promise<LiveStatus> {
    let productStatus = '';
    let offerStatus = '';
    let hasError = false;

    if (extra?.productImportId) {
      const s = await this.client.getProductImportStatus(extra.productImportId);
      productStatus = s.status;
      hasError = hasError || s.hasErrorReport;
    }
    if (extra?.offerImportId) {
      const s = await this.client.getOfferImportStatus(extra.offerImportId);
      offerStatus = s.status;
      hasError = hasError || s.hasErrorReport;
    }

    if (hasError) return { status: 'error', raw: { productStatus, offerStatus } };

    if (importDone(offerStatus) && (!extra?.productImportId || importDone(productStatus))) {
      const live = await this.client.getOfferBySku(ref).catch(() => null);
      const active = (live as { active?: boolean } | null)?.active;
      return { status: active === false ? 'ended' : 'active', raw: { live, productStatus, offerStatus } };
    }

    return { status: 'pending', raw: { productStatus, offerStatus } };
  }
}
