import { NextRequest, NextResponse } from 'next/server';
import { getLiveOffer } from '@/lib/allegro';

/**
 * GET /api/allegro/offer?allegroOfferId=XXX&accountId=YYY
 * Fetches the live offer from Allegro API and maps it to AllegroFormData shape
 * so the edit form can be pre-populated with current Allegro data.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const allegroOfferId = searchParams.get('allegroOfferId');
  const accountId = searchParams.get('accountId') || 'default';

  if (!allegroOfferId) {
    return NextResponse.json({ error: 'allegroOfferId is required' }, { status: 400 });
  }

  try {
    const offer = await getLiveOffer(allegroOfferId, accountId);
    console.log('[allegro/offer] raw description:', JSON.stringify((offer as Record<string, unknown>).description).slice(0, 500));
    const formData = mapAllegroOfferToFormData(offer);
    console.log('[allegro/offer] mapped description:', (formData as Record<string, unknown>).description?.toString().slice(0, 300));
    return NextResponse.json({ formData, raw: offer });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch offer from Allegro', details: String(error) },
      { status: 500 }
    );
  }
}

type AllegroParam = { id: string; values?: { value: string }[]; valuesIds?: { valueId: string }[]; rangeValue?: { from: string; to: string } };

function mapAllegroOfferToFormData(offer: Record<string, unknown>): Record<string, unknown> {
  // Extract category
  const category = (offer.category as { id?: string } | undefined);
  const categoryId = category?.id ?? '';

  // Extract product info
  const product = (offer.product as Record<string, unknown> | undefined);
  const productParams: AllegroParam[] = (product?.parameters as AllegroParam[]) || [];

  // Extract offer params
  const offerParams: AllegroParam[] = (offer.parameters as AllegroParam[]) || [];

  // Merge all params — convert Allegro format → our {paramId: value} map
  const params: Record<string, string | string[]> = {};
  for (const p of [...productParams, ...offerParams]) {
    if (!p.id) continue;
    if (p.valuesIds && p.valuesIds.length > 0) {
      const ids = p.valuesIds.map((v) => v.valueId);
      params[p.id] = ids.length === 1 ? ids[0] : ids;
    } else if (p.values && p.values.length > 0) {
      const vals = p.values.map((v) => v.value);
      params[p.id] = vals.length === 1 ? vals[0] : vals;
    } else if (p.rangeValue) {
      params[p.id] = p.rangeValue.from;
    }
  }

  // Title — may be per-language
  const name = offer.name as string | undefined;

  // Price
  const sellingMode = offer.sellingMode as Record<string, unknown> | undefined;
  const price = Number((sellingMode?.price as Record<string, unknown> | undefined)?.amount ?? 0);

  // Stock
  const stock = offer.stock as Record<string, unknown> | undefined;
  const quantity = Number(stock?.available ?? 1);

  // Images — Allegro returns plain string[] of URLs (not objects)
  const rawImages = (offer.images as unknown[] | undefined) || [];
  const images = rawImages
    .map(img => typeof img === 'string' ? img : (img as { url?: string }).url ?? '')
    .filter(Boolean) as string[];

  // Preserve Allegro's native sections structure, but split TEXT items that embed
  // <img> tags into separate TEXT + IMAGE items so the block editor renders them correctly.
  const rawDesc = (offer.description ?? (product as Record<string, unknown> | undefined)?.description) as
    { sections?: { items?: { type?: string; content?: string; url?: string }[] }[] } | null | undefined;
  const description = (rawDesc && typeof rawDesc === 'object' && Array.isArray(rawDesc.sections))
    ? JSON.stringify({ sections: rawDesc.sections.map(expandSection) })
    : '';

  // Delivery
  const delivery = offer.delivery as Record<string, unknown> | undefined;
  const shippingRates = delivery?.shippingRates as Record<string, string> | undefined;

  // Invoice
  const invoice = offer.invoice as Record<string, unknown> | undefined;
  const invoiceType = (invoice?.type as string | undefined) === 'VAT' ? 'VAT' : 'VAT_MARGIN';

  // Condition
  const condition = (offer.condition as string | undefined) === 'NEW' ? 'NEW' : 'USED';

  // SKU from external
  const external = offer.external as Record<string, unknown> | undefined;
  const sku = (external?.id as string | undefined) ?? '';

  return {
    title: name ?? '',
    sku,
    categoryId,
    categoryName: '',
    description,
    price,
    quantity,
    quantity_in_set: 1,
    condition,
    invoice: invoiceType,
    images,
    shippingCost: 0,
    shippingTime: (delivery?.handlingTime as string | undefined) ?? 'PT24H',
    shippingRateIds: shippingRates
      ? Object.fromEntries(Object.entries(shippingRates).map(([k, v]) => [k, v]))
      : {},
    params,
  };
}

type RawItem = { type?: string; content?: string; url?: string };
type OutItem = { type: 'TEXT'; content: string } | { type: 'IMAGE'; url: string };

/** Splits a section's TEXT items that embed <img> tags into separate TEXT/IMAGE items. */
function expandSection(section: { items?: RawItem[] }): { items: OutItem[] } {
  const out: OutItem[] = [];
  const IMG_RE = /<img[^>]+src=["']([^"']+)["'][^>]*\/?>/gi;

  for (const item of section.items ?? []) {
    if (item.type === 'IMAGE' && item.url) {
      out.push({ type: 'IMAGE', url: item.url });
      continue;
    }
    if (item.type !== 'TEXT' || !item.content) continue;

    // Split TEXT content on <img> tags → interleave TEXT and IMAGE items
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    IMG_RE.lastIndex = 0;
    while ((match = IMG_RE.exec(item.content)) !== null) {
      const before = item.content.slice(lastIndex, match.index).trim();
      if (before) out.push({ type: 'TEXT', content: before });
      out.push({ type: 'IMAGE', url: match[1] });
      lastIndex = match.index + match[0].length;
    }
    const tail = item.content.slice(lastIndex).trim();
    if (tail) out.push({ type: 'TEXT', content: tail });
  }

  return { items: out.length > 0 ? out : [{ type: 'TEXT', content: '' }] };
}
