import { NextRequest, NextResponse } from 'next/server';
import { KauflandClient } from '@/lib/marketplaces/kaufland/client';

/**
 * GET /api/kaufland/product-data-status?ean=…
 *
 * Werdykt Kauflandu dla danych produktowych EAN-u: co przyjął, czego brakuje i co odrzucił
 * (zdjęcia, zły język opisu), plus informacja, czy produkt ma kontakt GPSR. Bez tego jedynym
 * źródłem tej wiedzy jest ręczne klikanie po Seller Center.
 */
export async function GET(req: NextRequest) {
  const ean = (req.nextUrl.searchParams.get('ean') || '').trim();
  if (!ean) return NextResponse.json({ error: 'ean required' }, { status: 400 });

  try {
    const [st, contacts] = await Promise.all([
      KauflandClient.getProductDataStatus(ean),
      KauflandClient.getProductContacts(ean),
    ]);
    const gpsr = contacts.length > 0;

    // Brak rekordu (404) = nigdy nie wysłaliśmy danych produktowych dla tego EAN-u.
    if (!st) {
      return NextResponse.json({
        ean, gpsr, ready: false, status: 'NONE',
        notReadyReason: 'NO_PRODUCT_DATA', failReason: null,
        missing: [], blocked: [], declined: [], pictures: { total: 0, rejected: 0 },
      });
    }
    return NextResponse.json({ ean, gpsr, ...st });
  } catch (error) {
    return NextResponse.json({ error: 'status failed', details: String(error) }, { status: 500 });
  }
}
