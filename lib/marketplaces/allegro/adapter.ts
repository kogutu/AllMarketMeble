import {
  getCategories as allegroGetCategories,
  searchAllegroCategories,
  getCategoryParameters,
  buildAllegroPayload,
  createOffer,
  updateOffer,
  getLiveOffer,
  endOffer,
  type AllegroParamDef,
} from '@/lib/allegro';
import type {
  MarketplaceAdapter,
  MarketplaceCategory,
  MarketplaceAttribute,
  OfferDraft,
  PublishOutcome,
  LiveStatus,
} from '@/lib/marketplaces/types';

interface RawAllegroCategory {
  id: string;
  name: string;
  leaf?: boolean;
  parent?: { id: string } | null;
}

function toCategory(c: RawAllegroCategory): MarketplaceCategory {
  return { code: c.id, label: c.name, leaf: c.leaf ?? false, parentCode: c.parent?.id ?? null };
}

function toAttribute(p: AllegroParamDef): MarketplaceAttribute {
  return {
    code: p.id,
    label: p.name,
    type: p.type,
    required: p.required,
    multiple: p.restrictions?.multipleChoices ?? false,
    values: p.dictionary?.map((d) => ({ code: d.id, label: d.value })),
  };
}

/**
 * Thin adapter over the existing Allegro client (`lib/allegro.ts`). It does NOT change any
 * Allegro behavior — the legacy `/api/allegro/*` endpoints keep calling the underlying
 * functions directly. This wrapper only exposes Allegro through the common interface so the
 * unified marketplace endpoints can treat Allegro and Mirakl uniformly.
 */
export class AllegroAdapter implements MarketplaceAdapter {
  readonly kind = 'allegro' as const;
  constructor(readonly accountId: string) {}

  async getCategories(parentCode?: string): Promise<MarketplaceCategory[]> {
    const raw = (await allegroGetCategories(parentCode)) as RawAllegroCategory[];
    return raw.map(toCategory);
  }

  async searchCategories(phrase: string): Promise<MarketplaceCategory[]> {
    const raw = (await searchAllegroCategories(phrase)) as RawAllegroCategory[];
    return raw.map(toCategory);
  }

  async getCategoryAttributes(categoryCode: string): Promise<MarketplaceAttribute[]> {
    const params = await getCategoryParameters(categoryCode);
    return params.map(toAttribute);
  }

  async publish(draft: OfferDraft): Promise<PublishOutcome> {
    const payload = await buildAllegroPayload(draft.formData, this.accountId);
    const { id } = await createOffer(payload, this.accountId);
    return { ref: id, status: 'active', raw: { id } };
  }

  async updateLive(ref: string, draft: OfferDraft): Promise<void> {
    const payload = await buildAllegroPayload(draft.formData, this.accountId);
    await updateOffer(ref, payload, this.accountId);
  }

  /** End (withdraw) a published Allegro offer. */
  async withdraw(ref: string): Promise<string> {
    await endOffer(ref, this.accountId);
    return ref;
  }

  async syncStatus(ref: string): Promise<LiveStatus> {
    const live = await getLiveOffer(ref, this.accountId);
    return {
      status: (live as { publication?: { status?: string } }).publication?.status ?? 'unknown',
      title: (live as { name?: string }).name ?? null,
      raw: live,
    };
  }
}
