import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { KauflandClient } from '@/lib/marketplaces/kaufland/client';
import { manufacturerContact, manufacturerName } from '@/lib/marketplaces/kaufland/gpsr';

/**
 * Kontakty GPSR dla asortymentu na Kauflandzie.
 *
 * Kaufland nie czyta GPSR z atrybutów produktu — ma do tego osobne API kontaktów. Zapis na
 * poziomie producenta działa tylko dla marek z katalogu Kauflandu (naszej nie rozpoznaje:
 * `manufacturer-not-found`), więc kontakt ustawiamy per EAN.
 *
 * GET  → co mamy w konfiguracji i ile ofert czeka na uzupełnienie.
 * POST → zapisuje kontakt dla partii EAN-ów (`limit`/`offset`, bo to jedno żądanie na produkt).
 *        Body `{ ean }` ogranicza zapis do jednego produktu.
 */

const CONCURRENCY = 6;

async function kauflandEans(limit: number, offset: number): Promise<string[]> {
  const rows = await query<{ ean: string }>(
    `SELECT DISTINCT ean FROM marketplace_live_offers
      WHERE marketplace = 'kaufland' AND ean IS NOT NULL AND ean <> ''
      ORDER BY ean ASC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  return rows.map((r) => r.ean);
}

export async function GET() {
  const contact = manufacturerContact();
  const [{ total }] = await query<{ total: number }>(
    `SELECT COUNT(DISTINCT ean) AS total FROM marketplace_live_offers
      WHERE marketplace = 'kaufland' AND ean IS NOT NULL AND ean <> ''`
  );
  if (!contact) {
    return NextResponse.json({
      configured: false, total,
      error: 'Brak danych GPSR w konfiguracji (KAUFLAND_GPSR_* lub ALLEGRO_PRODUCER_*)',
    });
  }
  return NextResponse.json({ configured: true, total, manufacturer: manufacturerName(), contact });
}

export async function POST(req: NextRequest) {
  const contact = manufacturerContact();
  if (!contact) {
    return NextResponse.json(
      { error: 'Brak danych GPSR w konfiguracji (KAUFLAND_GPSR_* lub ALLEGRO_PRODUCER_*)' },
      { status: 400 }
    );
  }

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get('limit') || 200), 500);
  const offset = Number(sp.get('offset') || 0);
  const single = await req.json().then((b) => String(b?.ean || '').trim()).catch(() => '');

  try {
    const eans = single ? [single] : await kauflandEans(limit, offset);
    let ok = 0;
    const errors: { ean: string; error: string }[] = [];

    for (let i = 0; i < eans.length; i += CONCURRENCY) {
      await Promise.all(eans.slice(i, i + CONCURRENCY).map(async (ean) => {
        try {
          await KauflandClient.putProductContact(ean, 'manufacturer', contact);
          ok += 1;
        } catch (e) {
          errors.push({ ean, error: String(e).slice(0, 200) });
        }
      }));
    }

    const [{ total }] = single
      ? [{ total: 1 }]
      : await query<{ total: number }>(
          `SELECT COUNT(DISTINCT ean) AS total FROM marketplace_live_offers
            WHERE marketplace = 'kaufland' AND ean IS NOT NULL AND ean <> ''`
        );
    const nextOffset = offset + eans.length;
    return NextResponse.json({
      success: true, manufacturer: manufacturerName(),
      processed: eans.length, ok, failed: errors.length,
      errors: errors.slice(0, 10), total, nextOffset,
      done: single ? true : nextOffset >= total || eans.length === 0,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Zapis kontaktów GPSR nie powiódł się', details: String(error) }, { status: 500 });
  }
}
