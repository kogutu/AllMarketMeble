import { KauflandClient, type KauflandUnit, type KauflandCategory } from './client';
import type {
  MarketplaceAdapter, MarketplaceCategory, MarketplaceAttribute,
  OfferDraft, PublishOutcome, LiveStatus, LiveOfferRow, LiveOffersAdapter,
} from '@/lib/marketplaces/types';

function toCategory(c: KauflandCategory): MarketplaceCategory {
  return {
    code: String(c.id_category),
    label: c.title_singular || c.name,
    leaf: c.is_leaf ?? false,
    parentCode: c.id_parent_category != null ? String(c.id_parent_category) : null,
  };
}

function firstEan(u: KauflandUnit): string | null {
  const e = u.product?.eans ?? u.product?.ean ?? u.ean;
  if (Array.isArray(e)) return e[0] ?? null;
  return (e as string) ?? null;
}

/**
 * Kaufland adapter (storefront PL). Phase 1: live offers (units) read + price/quantity edit,
 * used by the sync/compare/products flows. Publishing (creating units) is a later phase.
 */
export class KauflandAdapter implements MarketplaceAdapter, LiveOffersAdapter {
  readonly kind = 'kaufland' as const;
  constructor(readonly accountId: string, readonly operator = 'pl') {}

  static async create(accountId = 'kaufland'): Promise<KauflandAdapter> {
    return new KauflandAdapter(accountId);
  }

  async listLiveOffers(offset = 0, limit = 100): Promise<{ total: number; offers: LiveOfferRow[] }> {
    const { units, total } = await KauflandClient.getUnits(offset, limit);
    return {
      total,
      offers: units.map((u): LiveOfferRow => {
        const id = String(u.id_unit ?? '');
        const active = (u.status ?? '').toUpperCase() === 'AVAILABLE' && (u.amount ?? 0) > 0;
        return {
          ref: id, offerId: id, sku: u.id_offer ?? id,
          ean: firstEan(u),
          title: u.note ?? u.product?.title ?? null,
          price: u.listing_price != null ? Number(u.listing_price) / 100 : null,
          quantity: u.amount != null ? Number(u.amount) : null,
          state: active ? 'active' : 'inactive',
          stateCode: u.condition ?? 'NEW',
          category: null,
          raw: u as Record<string, unknown>,
        };
      }),
    };
  }

  async updateOfferByRef(row: { ref: string }, price: number, quantity: number): Promise<string> {
    await KauflandClient.updateUnit(row.ref, price, quantity);
    return row.ref;
  }

  // ── MarketplaceAdapter surface ─────────────────────────────────────────────
  async getCategories(parentCode?: string): Promise<MarketplaceCategory[]> {
    const parent = parentCode ? Number(parentCode) : undefined;
    const cats = await KauflandClient.getCategories(parent);
    return cats.map(toCategory);
  }

  /** Kaufland has no category search endpoint — fetch a wide page and filter by title. */
  async searchCategories(phrase: string): Promise<MarketplaceCategory[]> {
    const cats = await KauflandClient.getCategories(undefined, 1000);
    const p = phrase.toLowerCase();
    return cats
      .filter((c) => (c.title_singular || c.name || '').toLowerCase().includes(p) || (c.title_plural || '').toLowerCase().includes(p))
      .filter((c) => c.is_leaf)
      .slice(0, 50)
      .map(toCategory);
  }

  /**
   * Kaufland exposes a single global attribute catalog (no per-category required schema).
   * We surface the most relevant offer-level fields as "attributes" for the form/AI; nothing
   * is marked required by the API, so create relies on the unit fields directly.
   */
  async getCategoryAttributes(): Promise<MarketplaceAttribute[]> { return []; }

  async publish(draft: OfferDraft): Promise<PublishOutcome> {
    const f = draft.formData as Record<string, unknown>;
    const ean = String(f.ean ?? '').trim();
    const idOffer = String(f.sku ?? f.id_offer ?? '').trim();
    if (!ean) return { ref: idOffer, status: 'error', raw: { error: 'Brak EAN — Kaufland dopasowuje produkt po EAN' } };
    if (!idOffer) return { ref: '', status: 'error', raw: { error: 'Brak SKU oferty (id_offer)' } };

    // Resolve shipping group / warehouse defaults if not provided.
    let idShipping = Number(f.id_shipping_group ?? 0);
    let idWarehouse = Number(f.id_warehouse ?? 0);
    if (!idShipping) {
      const groups = await KauflandClient.getShippingGroups();
      idShipping = (groups.find((g) => g.is_default) ?? groups[0])?.id_shipping_group ?? 0;
    }
    if (!idWarehouse) {
      const whs = await KauflandClient.getWarehouses();
      idWarehouse = (whs.find((w) => w.is_default) ?? whs[0])?.id_warehouse ?? 0;
    }

    const unit = await KauflandClient.createUnit({
      id_offer: idOffer,
      ean,
      price: Number(f.price ?? draft.basePrice ?? 0),
      amount: Number(f.quantity ?? f.amount ?? 1),
      condition: String(f.condition ?? 'NEW'),
      minimum_price: f.minimum_price != null ? Number(f.minimum_price) : undefined,
      handling_time: f.handling_time != null ? Number(f.handling_time) : 1,
      note: f.title ? String(f.title) : undefined,
      id_shipping_group: idShipping,
      id_warehouse: idWarehouse,
      id_category: f.categoryCode != null ? Number(f.categoryCode) : undefined,
    });
    const ref = String(unit.id_unit ?? idOffer);
    return { ref, status: 'active', raw: unit as Record<string, unknown> };
  }

  /** Withdraw an offer from Kaufland by unit id. */
  async withdraw(ref: string): Promise<string> {
    await KauflandClient.deleteUnit(ref);
    return ref;
  }

  async updateLive(): Promise<void> { throw new Error('not implemented'); }
  async syncStatus(ref: string): Promise<LiveStatus> {
    const u = await KauflandClient.getUnit(ref);
    return { status: u ? ((u.amount ?? 0) > 0 ? 'active' : 'inactive') : 'unknown', raw: u };
  }
}
