import { KauflandClient, type KauflandUnit, type KauflandCategory, type KauflandProductData } from './client';
import type {
  MarketplaceAdapter, MarketplaceCategory, MarketplaceAttribute,
  OfferDraft, PublishOutcome, LiveStatus, LiveOfferRow, LiveOffersAdapter,
} from '@/lib/marketplaces/types';

/** Normalizacja do dopasowań: małe litery, bez diakrytyk, interpunkcja → spacja. */
function normCat(s: string): string {
  return (s || '').toLowerCase()
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l')
    .replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/[źż]/g, 'z')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

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
        // is_live: false → unit istnieje w API ale NIE jest widoczny na Kaufland.pl (brak atrybutów,
        // oczekuje na zatwierdzenie katalogu itp.) → traktuj jako inactive (żółta kropka, nie zielona).
        const available = (u.status ?? '').toUpperCase() === 'AVAILABLE' && (u.amount ?? 0) > 0;
        const active = available && u.is_live !== false;
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

  /**
   * Kaufland has no category search endpoint — fetch the full (cached) tree and filter by title.
   * Dopasowanie odporne na interpunkcję/diakrytyki: „Stolik-kawowy", „biały," itd. są normalizowane,
   * a wynik punktowany po liczbie trafionych tokenów (pełna fraza jako podłańcuch = bonus).
   */
  async searchCategories(phrase: string): Promise<MarketplaceCategory[]> {
    const cats = await KauflandClient.getAllCategories();
    const q = normCat(phrase);
    if (!q) return [];
    const tokens = q.split(' ').filter((t) => t.length >= 3);
    const scored: { c: KauflandCategory; score: number }[] = [];
    for (const c of cats) {
      if (!c.is_leaf) continue;
      const t = normCat(`${c.title_singular || ''} ${c.name || ''} ${c.title_plural || ''}`);
      if (!t) continue;
      const hits = tokens.filter((tok) => t.includes(tok)).length;
      const full = t.includes(q);
      // Brak tokenów ≥3 znaki → dopasuj po pełnej frazie; inaczej wymagaj ≥1 trafionego tokenu.
      const score = (full ? 3 : 0) + hits;
      if (tokens.length === 0 ? full : score > 0) scored.push({ c, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 50).map((s) => toCategory(s.c));
  }

  /**
   * Kaufland API nie ma per-kategoria schematu wymaganych atrybutów (`id_category` na `/attributes`
   * nie filtruje — zwraca cały katalog 727 globalnych pozycji). Zwracamy zestaw standardowy dla
   * mebli. Wartości przechowywane w szkicu; Kaufland Seller Center wymaga uzupełnienia „Product data"
   * ręcznie (endpoint /product-data → 404 — edycja katalogu produktów nie jest dostępna via API).
   */
  async getCategoryAttributes(): Promise<MarketplaceAttribute[]> {
    return [
      { code: 'manufacturer',  label: 'Producent',                    type: 'TEXT',  required: false },
      { code: 'mpn',           label: 'Numer producenta (MPN)',        type: 'TEXT',  required: false },
      { code: 'colour',        label: 'Kolor',                         type: 'TEXT',  required: false, multiple: true },
      { code: 'material',      label: 'Materiał',                      type: 'TEXT',  required: false, multiple: true },
      { code: 'wood_type',     label: 'Rodzaj drewna / mat. dekor.',   type: 'TEXT',  required: false },
      { code: 'width',         label: 'Szerokość (np. 50 cm)',         type: 'SI_M',  required: false },
      { code: 'height',        label: 'Wysokość (np. 75 cm)',          type: 'SI_M',  required: false },
      { code: 'depth',         label: 'Głębokość (np. 45 cm)',         type: 'SI_M',  required: false },
      { code: 'length',        label: 'Długość (np. 120 cm)',          type: 'SI_M',  required: false },
      { code: 'weight',        label: 'Waga (np. 15 kg)',              type: 'SI_KG', required: false },
    ];
  }

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

    const price = Number(f.price ?? draft.basePrice ?? 0);
    const amount = Number(f.quantity ?? f.amount ?? 1);
    let unit: Awaited<ReturnType<typeof KauflandClient.createUnit>>;
    try {
      unit = await KauflandClient.createUnit({
        id_offer: idOffer,
        ean,
        price,
        amount,
        condition: String(f.condition ?? 'NEW'),
        minimum_price: f.minimum_price != null && f.minimum_price !== '' && Number(f.minimum_price) > 0 ? Number(f.minimum_price) : undefined,
        handling_time: f.handling_time != null ? Number(f.handling_time) : 1,
        note: f.title ? String(f.title) : undefined,
        id_shipping_group: idShipping,
        id_warehouse: idWarehouse,
      });
    } catch (err: unknown) {
      // Jeśli unit już istnieje → zaktualizuj cenę i ilość zamiast tworzyć duplikat.
      const msg = String((err as Error).message ?? '');
      if (msg.includes('already-exists')) {
        const existing = await KauflandClient.findUnitByOffer(idOffer);
        if (!existing?.id_unit) throw err;
        const idUnit = String(existing.id_unit);
        await KauflandClient.updateUnit(idUnit, price, amount);
        // submitProductData uruchamiamy poniżej — po wyjściu z bloku catch
        unit = existing;
      } else {
        throw err;
      }
      throw err;
    }
    const ref = String((unit as KauflandUnit).id_unit ?? idOffer);

    // Wyślij product data do katalogu Kaufland (tytuł, opis, zdjęcia, producent).
    // Non-fatal: jeśli się nie uda, unit już istnieje — product data można uzupełnić ręcznie.
    const images: string[] = Array.isArray(f.images) ? (f.images as string[]).filter(Boolean) :
      (draft.product?.gallery_images ?? (draft.product?.img ? [draft.product.img as string] : []));
    const description = String(f.description ?? draft.product?.description ?? '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 65000);
    const attrs = (f.attributes as Record<string, string> | undefined) ?? {};
    const productData: KauflandProductData = {
      ean,
      title:         String(f.title ?? draft.product?.name ?? idOffer).slice(0, 512),
      manufacturer:  attrs.manufacturer || 'Mebel Partner',
      mpn:           attrs.mpn || idOffer,
      category:      String(f.categoryLabel ?? ''),
      ...(description              ? { description }                                           : {}),
      ...(f.short_description      ? { short_description: String(f.short_description).slice(0, 1024) } : {}),
      ...(images.length            ? { images: images.slice(0, 10) }                           : {}),
      ...(attrs.colour             ? { colour: attrs.colour }                                  : {}),
      ...(attrs.material           ? { material: attrs.material }                              : {}),
      ...(attrs.wood_type          ? { wood_type: attrs.wood_type }                            : {}),
      ...(attrs.width              ? { width: attrs.width }                                    : {}),
      ...(attrs.height             ? { height: attrs.height }                                  : {}),
      ...(attrs.depth              ? { depth: attrs.depth }                                    : {}),
      ...(attrs.length             ? { length: attrs.length }                                  : {}),
      ...(attrs.weight             ? { weight: attrs.weight }                                  : {}),
    };
    await KauflandClient.submitProductData(productData).catch((e) =>
      console.warn('[kaufland] submitProductData failed (non-fatal):', String(e).slice(0, 200))
    );

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
