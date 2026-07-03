/**
 * BULK dodawanie produktów: kolejka w DB + serwerowy worker (in-process), który dla każdego
 * wybranego produktu uruchamia nasz zautomatyzowany proces (sugestia kategorii → AI fill →
 * zapis SZKICU oferty) dla danego marketplace. Zatrzymujemy się na szkicu (do przeglądu).
 *
 * Worker jest jednym, współdzielonym w procesie Node singletonem — działa w tle niezależnie od
 * tego, czy panel „Dodawane" jest otwarty. Reużywa istniejących endpointów HTTP (ta sama logika
 * co formularze), żeby nie duplikować orkiestracji AI per marketplace.
 */
import { query } from '@/lib/db';
import { searchProducts } from '@/lib/typesense';

export type BulkStatus = 'pending' | 'processing' | 'done' | 'error' | 'published';

export interface BulkItem {
  id: number;
  batch_id: string;
  batch_name: string | null;
  typesense_id: string;
  ean: string | null;
  collection: string;
  marketplace: string;
  status: BulkStatus;
  draft_id: number | null;
  title: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await query(`CREATE TABLE IF NOT EXISTS bulk_add_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_id VARCHAR(40) NOT NULL DEFAULT '',
    batch_name VARCHAR(200) NULL,
    typesense_id VARCHAR(64) NOT NULL,
    ean VARCHAR(20) NULL,
    collection VARCHAR(64) NOT NULL DEFAULT 'meble',
    marketplace VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    draft_id INT NULL,
    title VARCHAR(500) NULL,
    error TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_item (typesense_id, marketplace, status),
    INDEX idx_status (status),
    INDEX idx_batch (batch_id)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  // Kolumny batch mogły nie istnieć we wcześniejszej wersji tabeli — dołóż je (ignoruj duplikaty).
  for (const ddl of [
    `ALTER TABLE bulk_add_queue ADD COLUMN batch_id VARCHAR(40) NOT NULL DEFAULT ''`,
    `ALTER TABLE bulk_add_queue ADD COLUMN batch_name VARCHAR(200) NULL`,
    `ALTER TABLE bulk_add_queue ADD COLUMN ean VARCHAR(20) NULL`,
  ]) {
    try { await query(ddl); } catch { /* kolumna już istnieje */ }
  }
  tableReady = true;
}

// Kontekst do wywołań wewnętrznych (origin + cookie auth), ustawiany przy enqueue z żądania.
let internalBase = process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
export function setInternalBase(origin: string): void {
  if (origin) internalBase = origin;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', Cookie: `auth_token=${process.env.ADMIN_TOKEN || ''}`, ...extra };
}

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${internalBase}${path}`, { ...init, headers: authHeaders(init?.headers as Record<string, string>) });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) throw new Error((data as { error?: string })?.error || `HTTP ${res.status} ${path}`);
  return data as T;
}

// ── Enqueue / listing ────────────────────────────────────────────────────────
export async function enqueue(
  items: { typesense_id: string; collection: string; marketplace: string }[],
  name?: string
): Promise<{ added: number; batchId: string }> {
  await ensureTable();
  // Jedno dodanie = jedna nazwana LISTA (batch). Nazwa domyślna z daty, jeśli użytkownik nie poda.
  const batchId = (globalThis.crypto?.randomUUID?.() ?? `b${Date.now()}${Math.random().toString(36).slice(2, 8)}`);
  const batchName = (name && name.trim()) || `Lista ${new Date().toLocaleString('pl')}`;
  const eanMap = await fetchEanMap(items);
  let added = 0;
  for (const it of items) {
    const existing = await query<{ id: number }>(
      `SELECT id FROM bulk_add_queue WHERE typesense_id=? AND marketplace=? AND status IN ('pending','processing') LIMIT 1`,
      [it.typesense_id, it.marketplace]
    );
    if ((existing as { id: number }[]).length) continue;
    await query(
      `INSERT INTO bulk_add_queue (batch_id, batch_name, typesense_id, ean, collection, marketplace, status) VALUES (?,?,?,?,?,?,'pending')`,
      [batchId, batchName, it.typesense_id, eanMap.get(it.typesense_id) ?? null, it.collection, it.marketplace]
    );
    added++;
  }
  return { added, batchId };
}

/** Pobiera EAN dla produktów kolejki (jednym zapytaniem per kolekcja, po id) — do wyświetlenia w panelu. */
async function fetchEanMap(items: { typesense_id: string; collection: string }[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const byCol = new Map<string, string[]>();
  for (const it of items) {
    if (!byCol.has(it.collection)) byCol.set(it.collection, []);
    byCol.get(it.collection)!.push(it.typesense_id);
  }
  for (const [collection, ids] of Array.from(byCol.entries())) {
    const uniq = Array.from(new Set(ids));
    for (let i = 0; i < uniq.length; i += 200) {
      const chunk = uniq.slice(i, i + 200);
      try {
        const res = await searchProducts(collection, { q: '*', perPage: chunk.length, filterBy: `id:[${chunk.join(',')}]` });
        for (const p of res.hits) if (p.ean) map.set(String(p.id), String(p.ean));
      } catch { /* brak dopasowania — EAN zostanie pusty */ }
    }
  }
  return map;
}

export async function listQueue(limit = 500): Promise<BulkItem[]> {
  await ensureTable();
  // Grupujemy per batch (najnowsze listy na górze), a wewnątrz — po kolejności dodania.
  return query<BulkItem>(
    `SELECT q.* FROM bulk_add_queue q
       JOIN (SELECT batch_id, MAX(id) AS max_id FROM bulk_add_queue GROUP BY batch_id) b
         ON b.batch_id = q.batch_id
     ORDER BY b.max_id DESC, q.id ASC LIMIT ?`,
    [limit]
  );
}

export async function clearQueue(scope: 'done' | 'all'): Promise<void> {
  await ensureTable();
  if (scope === 'all') await query(`DELETE FROM bulk_add_queue WHERE status <> 'processing'`);
  else await query(`DELETE FROM bulk_add_queue WHERE status IN ('done','published','error')`);
}

/** Ręczne usunięcie pojedynczej pozycji z kolejki. */
export async function deleteItem(id: number): Promise<void> {
  await ensureTable();
  await query(`DELETE FROM bulk_add_queue WHERE id=?`, [id]);
}

/** Usunięcie całej nazwanej listy. */
export async function deleteBatch(batchId: string): Promise<void> {
  await ensureTable();
  await query(`DELETE FROM bulk_add_queue WHERE batch_id=?`, [batchId]);
}

/** Oznaczenie pozycji jako WYSTAWIONA (trwałe — pomijane przy „Wystaw wszystkie"). */
export async function markPublished(id: number): Promise<void> {
  await ensureTable();
  await query(`UPDATE bulk_add_queue SET status='published' WHERE id=? AND status='done'`, [id]);
}

async function setStatus(id: number, status: BulkStatus, patch: Partial<Pick<BulkItem, 'draft_id' | 'title' | 'error'>> = {}): Promise<void> {
  await query(
    `UPDATE bulk_add_queue SET status=?, draft_id=COALESCE(?, draft_id), title=COALESCE(?, title), error=? WHERE id=?`,
    [status, patch.draft_id ?? null, patch.title ?? null, patch.error ?? null, id]
  );
}

// ── Per-marketplace pipeline (reużywa istniejących endpointów) ───────────────
async function processAllegro(item: BulkItem): Promise<{ draftId: number; title: string }> {
  const productId = item.typesense_id;
  const cat = await api<{ categoryId?: string; categoryName?: string }>(`/api/ai/suggest-category`, {
    method: 'POST', body: JSON.stringify({ productId, collection: item.collection }),
  });
  if (!cat.categoryId) throw new Error('AI nie dobrało kategorii');

  const [pp, pr] = await Promise.all([
    api<{ parameters?: unknown[] }>(`/api/allegro/categories/${encodeURIComponent(cat.categoryId)}/product-parameters`).catch(() => ({ parameters: [] })),
    api<{ parameters?: unknown[] }>(`/api/allegro/categories/${encodeURIComponent(cat.categoryId)}/parameters`).catch(() => ({ parameters: [] })),
  ]);
  const categoryParams = [ ...(pp.parameters || []), ...(pr.parameters || []) ];

  const fill = await api<{ formData?: Record<string, unknown> }>(`/api/ai/fill`, {
    method: 'POST',
    body: JSON.stringify({ productId, collection: item.collection, categoryId: cat.categoryId, categoryName: cat.categoryName, categoryParams }),
  });
  const formData = { ...(fill.formData || {}), categoryId: cat.categoryId, categoryName: cat.categoryName };
  const title = String((formData as { title?: string }).title || '');

  const draft = await api<{ id: number }>(`/api/offers`, {
    method: 'POST',
    body: JSON.stringify({
      typesense_id: productId, typesense_collection: item.collection, marketplace: 'allegro',
      form_data: formData, title, description: (formData as { description?: string }).description || '',
      price: (formData as { price?: number }).price ?? null, category_id: cat.categoryId,
    }),
  });
  return { draftId: draft.id, title };
}

async function processMirakl(item: BulkItem, operator: 'empik' | 'brw'): Promise<{ draftId: number; title: string }> {
  const productId = item.typesense_id;
  const accountId = operator;
  const cat = await api<{ categoryCode?: string; categoryLabel?: string }>(`/api/mirakl/suggest-category`, {
    method: 'POST', body: JSON.stringify({ productId, operator, accountId, collection: item.collection }),
  });
  if (!cat.categoryCode) throw new Error('AI nie dobrało kategorii');

  const fill = await api<{ title?: string; description?: string; attributes?: Record<string, unknown> }>(`/api/mirakl/fill`, {
    method: 'POST',
    body: JSON.stringify({ productId, operator, accountId, categoryCode: cat.categoryCode, categoryLabel: cat.categoryLabel, collection: item.collection }),
  });

  // Minimalny, spójny z formularzem MiraklFormData kształt szkicu (resztę uzupełni przegląd w formularzu).
  const prod = await api<{ hits?: Record<string, unknown>[] } & Record<string, unknown>>(`/api/products/${encodeURIComponent(productId)}?collection=${encodeURIComponent(item.collection)}`).catch(() => null);
  const p = (prod as { product?: Record<string, unknown> })?.product || (prod as Record<string, unknown>) || {};
  const form = {
    sku: String(p.sku || productId), ean: String(p.ean || ''),
    categoryCode: cat.categoryCode, categoryLabel: cat.categoryLabel || cat.categoryCode,
    title: fill.title || String(p.name || ''), description: fill.description || '',
    attributes: fill.attributes || {}, quantity: 1, condition: 'NEW',
    price: Number(p.price_gross ?? p.finalprice ?? 0), operator,
  };

  const draft = await api<{ id: number }>(`/api/offers`, {
    method: 'POST',
    body: JSON.stringify({
      typesense_id: productId, typesense_collection: item.collection, marketplace: 'mirakl',
      form_data: form, title: form.title, description: form.description, price: form.price, quantity: form.quantity,
      category_id: cat.categoryCode,
    }),
  });
  return { draftId: draft.id, title: form.title };
}

async function processKaufland(item: BulkItem): Promise<{ draftId: number; title: string }> {
  const productId = item.typesense_id;
  type KCat = { categoryCode?: string; categoryId?: string; categoryLabel?: string };
  type KFill = { formData?: Record<string, unknown>; title?: string; description?: string };
  const cat: KCat = await api<KCat>(`/api/kaufland/suggest-category`, {
    method: 'POST', body: JSON.stringify({ productId, collection: item.collection }),
  }).catch(() => ({}));
  const fill: KFill = await api<KFill>(`/api/kaufland/fill`, {
    method: 'POST', body: JSON.stringify({ productId, collection: item.collection }),
  }).catch(() => ({}));

  const form = { ...(fill.formData || {}), category: cat.categoryCode || cat.categoryId };
  const title = String(fill.title || (form as { title?: string }).title || '');
  const draft = await api<{ id: number }>(`/api/offers`, {
    method: 'POST',
    body: JSON.stringify({
      typesense_id: productId, typesense_collection: item.collection, marketplace: 'kaufland',
      form_data: form, title, description: fill.description || (form as { description?: string }).description || '',
      price: (form as { price?: number }).price ?? null, category_id: cat.categoryCode || cat.categoryId || null,
    }),
  });
  return { draftId: draft.id, title };
}

async function processItem(item: BulkItem): Promise<void> {
  await setStatus(item.id, 'processing');
  try {
    let res: { draftId: number; title: string };
    switch (item.marketplace) {
      case 'allegro': res = await processAllegro(item); break;
      case 'empik': res = await processMirakl(item, 'empik'); break;
      case 'brw': res = await processMirakl(item, 'brw'); break;
      case 'kaufland': res = await processKaufland(item); break;
      default: throw new Error(`Nieobsługiwany marketplace: ${item.marketplace}`);
    }
    await setStatus(item.id, 'done', { draft_id: res.draftId, title: res.title, error: null });
  } catch (e) {
    await setStatus(item.id, 'error', { error: String((e as Error)?.message || e).slice(0, 900) });
  }
}

// ── Background worker (in-process, samo-podtrzymujący się) ────────────────────
let running = false;
export function kickWorker(): void {
  if (running) return;
  running = true;
  void (async () => {
    try {
      for (;;) {
        await ensureTable();
        const rows = await query<BulkItem>(`SELECT * FROM bulk_add_queue WHERE status='pending' ORDER BY id ASC LIMIT 1`);
        const next = (rows as BulkItem[])[0];
        if (!next) break;
        await processItem(next);
      }
    } catch {
      /* worker padł — kolejny enqueue/kick go wznowi */
    } finally {
      running = false;
    }
  })();
}
