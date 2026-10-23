import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { KauflandClient } from '@/lib/marketplaces/kaufland/client';
import { problemList, describeProductData, PROBLEM_KIND as KIND } from '@/lib/marketplaces/kaufland/diagnostics';

export const dynamic = 'force-dynamic';

/**
 * Oferty Kauflandu, które nie docierają do klientów („Inactive”/„Invalid” w Seller Center),
 * z powodem. Powody są dwupoziomowe:
 *
 *  - poziom OFERTY (`status`, `amount`, `note`, `product.is_valid`) — mamy to już w bazie
 *    z synchronizacji, więc widok działa od razu, bez ruchu do Kauflandu;
 *  - poziom DANYCH PRODUKTOWYCH (czego brakuje, co odrzucono) — to wymaga jednego żądania
 *    na EAN, więc pobiera się je osobno przyciskiem (POST poniżej).
 *
 * GET  → lista z bazy.
 * POST → dociąga diagnozę danych produktowych partiami (`limit`/`offset`) i zapisuje ją przy ofercie.
 */

export interface KauflandInvalidRow {
  ref: string;
  ean: string | null;
  sku: string;
  title: string | null;
  img: string;
  typesenseId: string | null;
  price: number | null;
  quantity: number | null;
  /** Główna kategoria problemu — do filtrowania i grupowania. */
  kind: string;
  /** Wszystko, co wiemy: poziom oferty + (jeśli pobrany) poziom danych produktowych. */
  problems: string[];
  /** Jednolinijkowe podsumowanie danych produktowych; puste, gdy jeszcze nie sprawdzano. */
  problem: string;
  pictures: string;
  gpsr: string;
  checkedAt: string | null;
}

interface DbRow {
  ref: string; ean: string | null; title: string | null;
  price: number | null; quantity: number | null; typesense_id: string | null;
  raw_json: Record<string, unknown> | string | null;
  base_json: Record<string, unknown> | string | null;
}

const parse = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return {}; } })() : (v as Record<string, unknown>)) || {};

const str = (v: unknown): string => (v == null ? '' : String(v));

/**
 * Powody widoczne wprost w danych oferty. `product.is_valid === false` to dokładnie ten stan,
 * który Seller Center pokazuje jako „Invalid”.
 */
function offerLevelProblems(raw: Record<string, unknown>): { kind: string; problems: string[] } {
  const problems: string[] = [];
  const valid = raw['product.is_valid'];
  const status = str(raw.status).toUpperCase();
  const amount = Number(raw.amount ?? 0);

  let kind: string = KIND.OTHER;
  if (valid === false) {
    problems.push('Kaufland uznał dane produktu za nieprawidłowe („Invalid”) — trzeba poprawić dane produktowe');
    kind = KIND.DATA;
  }
  if (status === 'ONHOLD') {
    problems.push('Oferta wstrzymana (ONHOLD) po stronie Kauflandu');
    if (kind === KIND.OTHER) kind = KIND.ONHOLD;
  }
  if (!amount) {
    problems.push('Stan magazynowy 0 — oferta nie może się wyświetlać');
    if (kind === KIND.OTHER) kind = KIND.STOCK;
  }
  if (!str(raw.note)) {
    problems.push('Brak tytułu oferty (pole „note”)');
    if (kind === KIND.OTHER) kind = KIND.TITLE;
  }
  if (!str(raw['product.main_picture'])) {
    problems.push('Brak zdjęcia głównego w katalogu Kauflandu');
    if (kind === KIND.OTHER) kind = KIND.DATA;
  }
  if (problems.length === 0) problems.push('Oferta nie jest widoczna, a dane oferty wyglądają poprawnie — sprawdź dane produktowe');
  return { kind, problems };
}

function toRow(r: DbRow): KauflandInvalidRow {
  const raw = parse(r.raw_json);
  const base = parse(r.base_json);
  const { kind, problems } = offerLevelProblems(raw);

  // Synchronizacja przepuszcza raw_json przez `flatten`, które skleja tablice w jeden string.
  const deep = Array.isArray(raw.pd_problems)
    ? (raw.pd_problems as string[])
    : str(raw.pd_problems).split('; ').filter(Boolean);

  return {
    ref: r.ref,
    ean: r.ean,
    sku: str(raw.id_offer),
    title: r.title || str(raw['product.title']) || str(base.name) || null,
    img: str(base.img) || str(raw['product.main_picture']),
    typesenseId: r.typesense_id,
    price: r.price != null ? Number(r.price) : null,
    quantity: r.quantity ?? null,
    kind,
    problems: [...problems, ...deep],
    problem: str(raw.pd_problem),
    pictures: str(raw.pd_pictures),
    gpsr: raw.pd_gpsr === true ? 'jest' : raw.pd_gpsr === false ? 'brak' : '',
    checkedAt: raw.pd_checked_at ? str(raw.pd_checked_at) : null,
  };
}

/** Oferty, których Kaufland nie pokazuje klientom. */
const WHERE_INVALID = `marketplace = 'kaufland' AND active = 0`;
/** Spośród nich te, które Kaufland odrzucił na poziomie danych produktu. */
const WHERE_DATA_INVALID = `${WHERE_INVALID} AND ean IS NOT NULL AND ean <> ''
  AND JSON_EXTRACT(raw_json, '$."product.is_valid"') = false`;

export async function GET() {
  try {
    const rows = await query<DbRow>(
      `SELECT ref, ean, title, price, quantity, typesense_id, raw_json, base_json
         FROM marketplace_live_offers WHERE ${WHERE_INVALID} ORDER BY id ASC`
    );
    const items = rows.map(toRow);
    return NextResponse.json({
      items,
      total: items.length,
      checked: items.filter((i) => i.checkedAt).length,
      byKind: items.reduce<Record<string, number>>((acc, i) => {
        acc[i.kind] = (acc[i.kind] ?? 0) + 1;
        return acc;
      }, {}),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error), items: [], total: 0 }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get('limit') || 50), 200);
  const offset = Number(sp.get('offset') || 0);
  // Domyślnie sprawdzamy tylko oferty odrzucone przez Kaufland na poziomie produktu —
  // dla reszty powód znamy już z danych oferty i nie ma po co wysyłać żądania.
  const where = sp.get('scope') === 'all'
    ? `${WHERE_INVALID} AND ean IS NOT NULL AND ean <> ''`
    : WHERE_DATA_INVALID;

  try {
    const rows = await query<DbRow>(
      `SELECT ref, ean, raw_json FROM marketplace_live_offers
        WHERE ${where} ORDER BY id ASC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const [{ total }] = await query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM marketplace_live_offers WHERE ${where}`
    );

    const CONCURRENCY = 6;
    const checkedAt = new Date().toISOString();
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      await Promise.all(rows.slice(i, i + CONCURRENCY).map(async (r) => {
        const ean = String(r.ean);
        const [st, contacts] = await Promise.all([
          KauflandClient.getProductDataStatus(ean).catch(() => null),
          KauflandClient.getProductContacts(ean).catch(() => []),
        ]);
        const gpsr = contacts.length > 0;
        const raw = parse(r.raw_json);
        raw.pd_problem = describeProductData(st);
        raw.pd_problems = problemList(st, gpsr);
        raw.pd_ready = st ? st.ready : false;
        raw.pd_status = st?.status ?? 'NONE';
        raw.pd_missing = st?.missing.join(', ') ?? '';
        raw.pd_pictures = st ? `${st.pictures.total - st.pictures.rejected}/${st.pictures.total}` : '0/0';
        raw.pd_gpsr = gpsr;
        raw.pd_checked_at = checkedAt;
        await query(
          `UPDATE marketplace_live_offers SET raw_json = ? WHERE marketplace = 'kaufland' AND ref = ?`,
          [JSON.stringify(raw), r.ref]
        );
      }));
    }

    const nextOffset = offset + rows.length;
    return NextResponse.json({
      success: true, processed: rows.length, total, nextOffset,
      done: rows.length === 0 || nextOffset >= total,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Odświeżenie diagnozy nie powiodło się', details: String(error) }, { status: 500 });
  }
}
