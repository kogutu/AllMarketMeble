import { NextRequest, NextResponse } from 'next/server';
import { KauflandClient } from '@/lib/marketplaces/kaufland/client';

/**
 * GET /api/kaufland/unit?idUnit=…   albo   ?idOffer=<SKU oferty>
 *
 * Stan wystawionej oferty (unitu) żywcem z Kauflandu. Potrzebny przy wejściu w edycję: lokalny
 * szkic nie zawsze istnieje (oferta mogła powstać masowo albo przyjść ze synchronizacji), a wtedy
 * jedynym źródłem prawdy o cenie, stanie i grupie wysyłki jest API.
 */
export async function GET(req: NextRequest) {
  const idUnit = (req.nextUrl.searchParams.get('idUnit') || '').trim();
  const idOffer = (req.nextUrl.searchParams.get('idOffer') || '').trim();
  if (!idUnit && !idOffer) {
    return NextResponse.json({ error: 'idUnit or idOffer required' }, { status: 400 });
  }

  try {
    const unit = idUnit
      ? await KauflandClient.getUnit(idUnit)
      : await KauflandClient.findUnitByOffer(idOffer);
    if (!unit) return NextResponse.json({ unit: null });

    const raw = unit as Record<string, unknown>;
    const num = (k: string): number | null => {
      const v = raw[k];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    // Ceny Kauflandu są w groszach — formularz operuje na złotówkach.
    const zl = (k: string): number | null => {
      const v = num(k);
      return v == null ? null : v / 100;
    };
    const firstEan = (v: unknown): string | null =>
      Array.isArray(v) ? (v[0] ? String(v[0]) : null) : v ? String(v) : null;

    return NextResponse.json({
      unit: {
        idUnit: unit.id_unit != null ? String(unit.id_unit) : null,
        idOffer: unit.id_offer ?? null,
        ean: firstEan(unit.ean) ?? firstEan(unit.product?.eans) ?? firstEan(unit.product?.ean),
        title: unit.note || unit.product?.title || null,
        price: zl('listing_price'),
        minimumPrice: zl('minimum_price'),
        quantity: num('amount'),
        condition: unit.condition ?? null,
        handlingTime: num('handling_time'),
        idShippingGroup: num('id_shipping_group'),
        idWarehouse: num('id_warehouse'),
        status: unit.status ?? null,
        isLive: typeof unit.is_live === 'boolean' ? unit.is_live : null,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'unit fetch failed', details: String(error) }, { status: 500 });
  }
}
