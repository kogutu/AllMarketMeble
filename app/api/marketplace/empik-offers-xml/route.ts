import { NextRequest, NextResponse } from 'next/server';
import { MiraklClient } from '@/lib/marketplaces/mirakl/client';

export const maxDuration = 300;

const DEFAULT_XML_URL = 'https://www.mebel-partner.pl/devback/xml/generators/xmls/empik.xml';

/**
 * POST /api/marketplace/empik-offers-xml
 * Pobiera feed ofertowy XML (format importu Mirakla OF01) i wysyła go do Empik przez API
 * (`/api/offers/imports`). Body (opcjonalnie): { url?, accountId? }.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const url = String(body?.url || DEFAULT_XML_URL);
    const accountId = String(body?.accountId || 'empik');

    const xmlRes = await fetch(url, { cache: 'no-store' });
    if (!xmlRes.ok) {
      return NextResponse.json({ error: `Nie udało się pobrać XML (${xmlRes.status})` }, { status: 502 });
    }
    const xml = await xmlRes.text();
    const offers = (xml.match(/<offer>/g) || []).length;
    if (!xml.includes('<offer')) {
      return NextResponse.json({ error: 'Pobrany plik nie wygląda na feed ofert (brak <offer>).' }, { status: 422 });
    }

    const client = await MiraklClient.forOperator('empik', accountId);
    const importId = await client.importOffersXml(xml);

    return NextResponse.json({ ok: true, importId, offers, bytes: xml.length, url });
  } catch (error) {
    return NextResponse.json({ error: 'Wysyłka ofert XML nie powiodła się', details: String(error) }, { status: 500 });
  }
}
