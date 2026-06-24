import { query } from '@/lib/db';
import { matchProductsByField } from '@/lib/typesense';
import { getAdapterBySlug } from '@/lib/marketplaces/registry';
import { getMarketplace } from '@/lib/marketplaces/catalog';
import { listAccountOffers, getLiveOffer, extractEanFromOffer } from '@/lib/allegro';
import { flatten } from '@/lib/marketplaces/flatten';
import type { LiveOffersAdapter } from '@/lib/marketplaces/types';
import type { MebleProduct } from '@/types';

const COLLECTION = 'meble';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function toMysqlDatetime(input: string | number): string {
  const d = new Date(typeof input === 'string' && /^\d+$/.test(input) ? Number(input) : input);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function baseSnapshot(p: MebleProduct) {
  return {
    typesense_id: p.id, name: p.name, img: p.img || p.gallery_images?.[0] || '',
    sku: p.sku, ean: p.ean, price: p.price_gross ?? null, qty: p.qty ?? null,
  };
}

/** Extract Allegro offer parameters into clean named keys: `param.<Nazwa> = wartości`. */
function allegroParams(detail: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (params: unknown) => {
    for (const p of (params as { name?: string; values?: string[] }[] | undefined) || []) {
      if (p?.name) out[`param.${p.name}`] = (p.values || []).join(', ');
    }
  };
  for (const ps of (detail.productSet as { product?: { parameters?: unknown } }[] | undefined) || []) add(ps?.product?.parameters);
  add(detail.parameters);
  // First image as a convenient column.
  const imgs = detail.images as string[] | undefined;
  if (imgs?.length) out['offer_image'] = imgs[0];
  return out;
}

interface UpsertRow {
  marketplace: string; ref: string; offer_id: string | null; ean: string | null; typesense_id: string | null;
  active: boolean; price: number | null; quantity: number | null; title: string | null; account_id: string | null;
  raw: Record<string, unknown>; base: object | null; meta: object;
}

async function upsert(rows: UpsertRow[], syncedAt: string) {
  if (rows.length === 0) return;
  const ph = rows.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(','); // 14 columns incl. synced_at
  const vals = rows.flatMap((r) => [
    r.marketplace, r.ref, r.offer_id, r.ean, r.typesense_id, r.active ? 1 : 0,
    r.price, r.quantity, r.title, r.account_id,
    JSON.stringify(flatten(r.raw)), r.base ? JSON.stringify(r.base) : null, JSON.stringify(r.meta),
    syncedAt,
  ]);
  await query(
    `INSERT INTO marketplace_live_offers
       (marketplace, ref, marketplace_offer_id, ean, typesense_id, active, price, quantity, title, account_id, raw_json, base_json, meta_json, synced_at)
     VALUES ${ph}
     ON DUPLICATE KEY UPDATE
       marketplace_offer_id=VALUES(marketplace_offer_id), ean=VALUES(ean), typesense_id=VALUES(typesense_id),
       active=VALUES(active), price=VALUES(price), quantity=VALUES(quantity), title=VALUES(title),
       account_id=VALUES(account_id), raw_json=VALUES(raw_json), base_json=VALUES(base_json),
       meta_json=VALUES(meta_json), synced_at=VALUES(synced_at)`,
    vals
  );
}

// ── sync_jobs (progress visible to the user) ─────────────────────────────────
export async function setJob(slug: string, patch: { status?: string; processed?: number; total?: number; message?: string | null; start?: boolean }) {
  const fields: string[] = ['marketplace'];
  const place: string[] = ['?'];
  const vals: (string | number | null)[] = [slug];
  const upd: string[] = [];
  if (patch.start) { fields.push('started_at'); place.push('NOW()'); }
  for (const [k, v] of Object.entries({ status: patch.status, processed: patch.processed, total: patch.total, message: patch.message })) {
    if (v === undefined) continue;
    fields.push(k); place.push('?'); vals.push(v as string | number | null); upd.push(`${k}=VALUES(${k})`);
  }
  if (patch.start) upd.push('started_at=VALUES(started_at)');
  await query(
    `INSERT INTO sync_jobs (${fields.join(',')}) VALUES (${place.join(',')})
     ON DUPLICATE KEY UPDATE ${upd.join(', ') || 'marketplace=marketplace'}`,
    vals
  );
}

export async function getJob(slug: string) {
  return (await query<{ marketplace: string; status: string; processed: number; total: number; message: string | null; started_at: string | null; updated_at: string }>(
    'SELECT * FROM sync_jobs WHERE marketplace = ?', [slug]
  ))[0] ?? null;
}

export async function lastSync(slug: string): Promise<string | null> {
  const r = await query<{ last: string | null }>('SELECT MAX(synced_at) AS last FROM marketplace_live_offers WHERE marketplace = ?', [slug]);
  return r[0]?.last ?? null;
}

export async function cleanupSync(slug: string, runStartedAt: number | string) {
  const ts = toMysqlDatetime(runStartedAt);
  await query('DELETE FROM marketplace_live_offers WHERE marketplace = ? AND synced_at <> ?', [slug, ts]);
}

export interface ChunkResult { processed: number; total: number; nextOffset: number; done: boolean; }

/** Process one page of a marketplace's live offers → upsert to DB. Updates sync_jobs progress. */
export async function syncChunk(slug: string, offset: number, limit: number, runStartedAt: number | string, accountId?: string): Promise<ChunkResult> {
  const def = getMarketplace(slug);
  if (!def) throw new Error(`Nieznany marketplace: ${slug}`);
  const syncedAt = toMysqlDatetime(runStartedAt);

  if (offset === 0) await setJob(slug, { status: 'running', processed: 0, total: 0, message: null, start: true });

  let result: ChunkResult;

  if (def.engine !== 'allegro') {
    const adapter = (await getAdapterBySlug(slug)) as unknown as LiveOffersAdapter;
    const { offers, total } = await adapter.listLiveOffers(offset, limit);
    const byEan = await matchProductsByField(COLLECTION, 'ean', offers.map((o) => o.ean || '').filter(Boolean));
    const rows: UpsertRow[] = offers.map((o) => {
      const p = (o.ean && byEan.get(o.ean)) || null;
      return {
        marketplace: slug, ref: o.ref, offer_id: o.offerId, ean: o.ean, typesense_id: p?.id ?? null,
        active: o.state === 'active', price: o.price, quantity: o.quantity, title: o.title, account_id: def.operator ?? slug,
        raw: o.raw || {}, base: p ? baseSnapshot(p) : null,
        meta: { ean: o.ean, stateCode: o.stateCode, leadtime: o.leadtime, logisticClass: o.logisticClass },
      };
    });
    await upsert(rows, syncedAt);
    const nextOffset = offset + limit;
    result = { processed: offers.length, total, nextOffset, done: nextOffset >= total };
  } else {
    const acc = accountId || 'default';
    const { offers, total } = await listAccountOffers(acc, offset, limit);
    const details: { o: Record<string, unknown>; id: string; ean: string | null; price: number | null; quantity: number | null; title: string | null; active: boolean }[] = [];
    for (let i = 0; i < offers.length; i += 3) {
      const batch = offers.slice(i, i + 3) as Record<string, unknown>[];
      const res = await Promise.all(batch.map(async (o) => {
        const id = String((o as { id?: string }).id);
        let ean: string | null = null;
        let detail: Record<string, unknown> = o;
        for (let a = 0; a < 3; a++) {
          try { detail = await getLiveOffer(id, acc); ean = extractEanFromOffer(detail); break; }
          catch (e) { if ((e as { response?: { status?: number } })?.response?.status === 429 && a < 2) { await sleep(1500 * (a + 1)); continue; } break; }
        }
        // Prefer the full detail for every value (the list endpoint is sparse).
        const src = (detail && Object.keys(detail).length > 1 ? detail : o) as Record<string, unknown>;
        const sm = (src as { sellingMode?: { price?: { amount?: string } } }).sellingMode;
        return {
          o: src, id, ean,
          price: sm?.price?.amount != null ? Number(sm.price.amount) : null,
          quantity: (src as { stock?: { available?: number } }).stock?.available ?? null,
          title: (src as { name?: string }).name ?? null,
          active: ((src as { publication?: { status?: string } }).publication?.status ?? '').toUpperCase() === 'ACTIVE',
        };
      }));
      details.push(...res);
      await sleep(120);
    }
    const byEan = await matchProductsByField(COLLECTION, 'ean', details.map((d) => d.ean || '').filter(Boolean) as string[]);
    const rows: UpsertRow[] = details.map((d) => {
      const p = (d.ean && byEan.get(d.ean)) || null;
      // Full offer detail + clean named parameters (param.<Nazwa>) for the grid.
      const raw = { ...d.o, ...allegroParams(d.o) };
      return {
        marketplace: slug, ref: d.id, offer_id: d.id, ean: d.ean, typesense_id: p?.id ?? null,
        active: d.active, price: d.price, quantity: d.quantity, title: d.title, account_id: acc,
        raw, base: p ? baseSnapshot(p) : null, meta: { ean: d.ean },
      };
    });
    await upsert(rows, syncedAt);
    const nextOffset = offset + limit;
    result = { processed: offers.length, total, nextOffset, done: nextOffset >= total };
  }

  await setJob(slug, { status: result.done ? 'done' : 'running', processed: offset + result.processed, total: result.total });
  return result;
}

/** Full server-side sync (used by CRON) — loops all chunks for a slug. */
export async function syncAll(slug: string, opts: { limit?: number; pace?: number } = {}): Promise<{ total: number }> {
  const def = getMarketplace(slug);
  if (!def) throw new Error(`Nieznany marketplace: ${slug}`);
  const limit = opts.limit ?? 100;
  const pace = opts.pace ?? 800;
  const runStartedAt = Date.now();
  try {
    let accountIds: (string | undefined)[] = [undefined];
    if (def.engine === 'allegro') {
      const accs = await query<{ account_id: string; is_active: number }>("SELECT account_id, is_active FROM allegro_tokens WHERE marketplace='allegro' AND is_active=1");
      accountIds = accs.map((a) => a.account_id);
      if (accountIds.length === 0) { await setJob(slug, { status: 'error', message: 'Brak aktywnych kont Allegro' }); return { total: 0 }; }
    }
    let grandTotal = 0;
    for (const accountId of accountIds) {
      let offset = 0; let done = false;
      do {
        const r = await syncChunk(slug, offset, limit, runStartedAt, accountId);
        grandTotal = Math.max(grandTotal, r.total);
        done = r.done; offset = r.nextOffset;
        await sleep(pace);
      } while (!done);
    }
    await cleanupSync(slug, runStartedAt);
    await setJob(slug, { status: 'done', message: null });
    return { total: grandTotal };
  } catch (e) {
    await setJob(slug, { status: 'error', message: String(e).slice(0, 480) });
    throw e;
  }
}
