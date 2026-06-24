'use client';

// ─────────────────────────────────────────────────────────────────────────────
// BLACK RED WHITE (BRW, Mirakl) — samodzielna siatka (pełna logika, brak współdzielenia).
// Edycja tego pliku NIE wpływa na Empik / Allegro / Kaufland.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import type { ColDef, ICellRendererParams, CellValueChangedEvent } from 'ag-grid-community';
import DataGrid from '@/components/grid/DataGrid';
import { getMarketplace, ACCENT_CLASSES } from '@/lib/marketplaces/catalog';
import { applyFormat } from '@/lib/grid/cellFormats';

const SLUG = 'brw';
const editPath = (typesenseId: string) => `/products/${typesenseId}/add-to-brw`;

type Row = Record<string, unknown>;

interface ApiItem {
  ref: string; ean: string | null; title: string | null; state: string;
  market: { price: number | null; quantity: number | null };
  base: { typesense_id: string; name: string; img: string; sku: string; ean: string; price: number | null; qty: number | null } | null;
  meta?: Record<string, unknown>;
  fields?: Record<string, string | number | boolean>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isHttp = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v);
const isImgUrl = (v: unknown) => isHttp(v) && /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(v as string);

function pickImage(row: Row): string {
  if (isHttp(row.base_img)) return row.base_img as string;
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'string' && isHttp(v) && /picture|image|img|zdjec|media|okladk|photo|foto/i.test(k)) return v;
  }
  for (const v of Object.values(row)) if (isImgUrl(v)) return v as string;
  return '';
}

interface FieldDef { field: string; label: string; }
interface ColView { field: string; label: string; visible: boolean; render?: string; }
interface SavedView { id: number; name: string; columns: ColView[]; is_default: boolean; }

function toRow(it: ApiItem): Row {
  return {
    ...(it.fields || {}),
    ref: it.ref, ean: it.ean, title: it.title, status: it.state,
    base_name: it.base?.name ?? '', base_img: it.base?.img ?? '', base_sku: it.base?.sku ?? '',
    base_price: it.base?.price ?? null, base_qty: it.base?.qty ?? null, base_typesense_id: it.base?.typesense_id ?? null,
    market_price: it.market.price, market_quantity: it.market.quantity, __meta: it.meta || {},
  };
}

export default function BrwGrid() {
  const def = getMarketplace(SLUG);
  const mpLabel = def?.name ?? SLUG;
  const accent = ACCENT_CLASSES[def?.accent ?? 'red'];

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProg, setSyncProg] = useState<{ processed: number; total: number } | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [views, setViews] = useState<SavedView[]>([]);
  const [selectedViewId, setSelectedViewId] = useState<number | ''>('');

  const selectView = (id: number | '') => {
    setSelectedViewId(id);
    try { localStorage.setItem(`mp-view:${SLUG}`, String(id)); } catch { /* quota */ }
  };

  useEffect(() => {
    fetch(`/api/marketplace/fields?slug=${SLUG}`).then((r) => r.json()).then((d) => setFields(d.fields || [])).catch(() => {});
    fetch(`/api/grid-views?slug=${SLUG}`).then((r) => r.json()).then((d) => {
      const vs: SavedView[] = d.views || [];
      setViews(vs);
      let saved: string | null = null;
      try { saved = localStorage.getItem(`mp-view:${SLUG}`); } catch { saved = null; }
      if (saved === '') setSelectedViewId('');
      else if (saved != null && vs.some((v) => String(v.id) === saved)) setSelectedViewId(Number(saved));
      else setSelectedViewId(vs.find((v) => v.is_default)?.id ?? '');
    }).catch(() => {});
  }, []);

  const loadFromDb = async () => {
    setLoading(true);
    try {
      const d = await fetch(`/api/marketplace/offers-db?slug=${SLUG}`).then((r) => r.json()).catch(() => null);
      setRows((d?.items || []).map(toRow));
    } finally { setLoading(false); }
  };

  useEffect(() => {
    loadFromDb();
    let prevRunning = false;
    const poll = async () => {
      const d = await fetch(`/api/marketplace/sync-status?slug=${SLUG}`).then((r) => r.json()).catch(() => null);
      if (!d) return;
      setLastSync(d.lastSync ?? null);
      const job = d.job;
      const running = job?.status === 'running';
      if (running && !syncing) setProgress({ done: job.processed, total: job.total });
      else if (!running) setProgress(null);
      if (prevRunning && !running) loadFromDb();
      prevRunning = running;
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncProg({ processed: 0, total: 0 });
    try {
      const runStartedAt = Date.now();
      let processed = 0; let grand = 0;
      let offset = 0; let done = false;
      do {
        let res: { error?: string; details?: string; processed?: number; total?: number; nextOffset?: number; done?: boolean } | null = null;
        for (let a = 0; a < 4; a++) {
          res = await fetch(`/api/marketplace/sync-live?slug=${SLUG}&offset=${offset}&limit=100&runStartedAt=${runStartedAt}`, { method: 'POST' })
            .then((r) => r.json()).catch(() => ({ error: 'network' }));
          if (!res?.error) break;
          if (a < 3) await sleep(3000 * (a + 1));
        }
        if (res?.error) { toast.error('Sync: ' + (res.details || res.error)); return; }
        processed += res!.processed || 0;
        grand = Math.max(grand, res!.total || 0);
        setSyncProg({ processed, total: grand });
        done = !!res!.done;
        offset = res!.nextOffset || offset + 100;
        await sleep(1350);
      } while (!done);
      await fetch(`/api/marketplace/sync-live?slug=${SLUG}&cleanup=1&runStartedAt=${runStartedAt}`, { method: 'POST' }).catch(() => {});
      setLastSync(new Date(runStartedAt).toISOString());
      toast.success('Zaktualizowano z BRW');
      await loadFromDb();
    } finally { setSyncing(false); setSyncProg(null); }
  };

  const onCellValueChanged = async (e: CellValueChangedEvent<Row>) => {
    const colId = e.column.getColId();
    if (colId !== 'market_price' && colId !== 'market_quantity') return;
    const row = e.data;
    const price = Number(row.market_price);
    const quantity = Number(row.market_quantity);
    if (Number.isNaN(price) || Number.isNaN(quantity)) { toast.error('Nieprawidłowa wartość'); return; }
    const res = await fetch('/api/marketplace/offers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: SLUG, ref: row.ref, price, quantity, meta: row.__meta }),
    });
    const d = await res.json();
    if (res.ok && d.success) toast.success(`Zaktualizowano: ${mpLabel}`);
    else toast.error('Błąd: ' + (d.details || d.error || 'nieznany'));
  };

  const columnDefs = useMemo<ColDef<Row>[]>(() => {
    const numParser = (p: { newValue: unknown }) => { const n = Number(p.newValue); return Number.isNaN(n) ? null : n; };
    const diffPrice = { 'text-red-600 font-semibold': (p: { data?: Row }) => p.data != null && p.data.base_price != null && p.data.market_price != null && Math.abs(Number(p.data.base_price) - Number(p.data.market_price)) > 0.01 };
    const diffQty = { 'text-red-600 font-semibold': (p: { data?: Row }) => p.data != null && p.data.base_qty != null && p.data.market_quantity != null && Number(p.data.base_qty) !== Number(p.data.market_quantity) };

    const imgCell = (p: ICellRendererParams<Row>) => {
      const u = isHttp(p.value) ? String(p.value) : pickImage(p.data || {});
      return u
        // eslint-disable-next-line @next/next/no-img-element
        ? <a href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="h-12 w-12 object-contain bg-gray-50 rounded border" /></a>
        : <span className="text-gray-300">—</span>;
    };

    const buildCol = (field: string, label?: string): ColDef<Row> => {
      const h = (d: string) => label || d;
      switch (field) {
        case 'base_name': return {
          headerName: h('Produkt'), field, pinned: 'left', width: 360, filter: 'agTextColumnFilter',
          cellRenderer: (p: ICellRendererParams<Row>) => {
            const u = pickImage(p.data || {});
            return (
              <div className="flex items-center gap-3 py-1">
                {u
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <a href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="h-12 w-12 object-contain bg-gray-50 rounded border shrink-0" /></a>
                  : <div className="h-12 w-12 rounded border border-dashed border-gray-200 shrink-0" />}
                <span className="leading-tight line-clamp-2 whitespace-normal">{String(p.value || p.data?.title || p.data?.ref || '')}</span>
              </div>
            );
          },
        };
        case 'base_img': return { headerName: h('Zdjęcie'), field, width: 80, sortable: false, filter: false, cellRenderer: imgCell };
        case 'ean': return { headerName: h('EAN'), field, width: 150, filter: 'agTextColumnFilter', cellClass: 'font-mono' };
        case 'base_price': return { headerName: h('Cena bazy'), field, width: 110, filter: 'agNumberColumnFilter', type: 'rightAligned' };
        case 'market_price': return { headerName: h(`Cena ${mpLabel}`), field, width: 120, editable: true, filter: 'agNumberColumnFilter', type: 'rightAligned', valueParser: numParser, cellClassRules: diffPrice };
        case 'base_qty': return { headerName: h('Ilość bazy'), field, width: 100, filter: 'agNumberColumnFilter', type: 'rightAligned' };
        case 'market_quantity': return { headerName: h(`Ilość ${mpLabel}`), field, width: 110, editable: true, filter: 'agNumberColumnFilter', type: 'rightAligned', valueParser: numParser, cellClassRules: diffQty };
        case 'status': return { headerName: h('Status'), field, width: 110 };
        case 'base_typesense_id': return {
          headerName: h('Akcje'), field, width: 90, pinned: 'right', sortable: false, filter: false,
          cellRenderer: (p: ICellRendererParams<Row>) => (p.value
            ? <a className="text-indigo-600 underline text-xs" href={editPath(String(p.value))}>Edytuj</a>
            : <span className="text-gray-300 text-xs">—</span>),
        };
        default: {
          const sample = rows.find((r) => r[field] != null)?.[field];
          const numeric = typeof sample === 'number';
          const image = isImgUrl(sample) || /picture|image|img|zdjec|media|okladk|photo|foto/i.test(field);
          return {
            headerName: h(field), field, minWidth: 120,
            filter: numeric ? 'agNumberColumnFilter' : 'agTextColumnFilter',
            type: numeric ? 'rightAligned' : undefined,
            cellRenderer: image ? imgCell : undefined,
          };
        }
      }
    };

    const view = views.find((v) => v.id === selectedViewId);
    if (view && view.columns?.length) {
      const inView = new Set(view.columns.map((c) => c.field));
      const cols = view.columns.map((c) => ({ ...applyFormat(buildCol(c.field, c.label), c.render), hide: !c.visible }));
      const rest = fields.filter((f) => !inView.has(f.field)).map((f) => ({ ...buildCol(f.field, f.label), hide: true }));
      return [...cols, ...rest];
    }
    const coreOrder = ['base_name', 'ean', 'base_price', 'market_price', 'base_qty', 'market_quantity', 'status', 'base_typesense_id'];
    const coreCols = coreOrder.map((f) => buildCol(f));
    const hiddenSkip = new Set([...coreOrder, 'ref', '__meta']);
    const dynCols = fields.filter((f) => !hiddenSkip.has(f.field)).map((f) => ({ ...buildCol(f.field, f.label), hide: true }));
    return [...coreCols, ...dynCols];
  }, [fields, views, selectedViewId, rows, mpLabel]);

  const pct = progress && progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
  const syncBusy = syncing || (progress != null);
  const toolbarLeft = (
    <>
      <h1 className="text-base font-bold text-gray-900 mr-2">{mpLabel} <span className="text-gray-400 font-normal">({rows.length})</span></h1>
      <button className={`btn-sm px-3 rounded-md text-white ${accent.btn} disabled:opacity-60`} onClick={runSync} disabled={syncBusy}>
        {syncing
          ? `Aktualizuję ${syncProg?.processed ?? 0}/${syncProg?.total || '?'}…`
          : progress ? `Sync w tle ${progress.done}/${progress.total || '?'} (${pct}%)` : 'Aktualizuj z marketplace'}
      </button>
      <button className="btn-secondary btn-sm" onClick={loadFromDb} disabled={loading}>Odśwież</button>
      <select className="input w-44 text-sm" value={String(selectedViewId)} onChange={(e) => selectView(e.target.value === '' ? '' : Number(e.target.value))}>
        <option value="">Widok: domyślny</option>
        {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      <a href={`/widoki?slug=${SLUG}`} className="text-xs text-indigo-600 underline">Zarządzaj widokami</a>
      <span className="text-xs text-gray-400">{lastSync ? `baza: ${new Date(lastSync).toLocaleString('pl')}` : 'brak danych — kliknij Aktualizuj'}</span>
    </>
  );

  return (
    <div className="w-full">
      <DataGrid<Row>
        rowData={rows}
        columnDefs={columnDefs}
        getRowId={(p) => String(p.data.ref)}
        onCellValueChanged={onCellValueChanged}
        loading={loading}
        toolbarLeft={toolbarLeft}
        exportName={`${SLUG}-oferty`}
        heightClass="h-[calc(100vh-150px)]"
        rowHeight={64}
      />
      <p className="text-xs text-gray-400 mt-1">
        Edytuj komórki <b>Cena {mpLabel}</b> / <b>Ilość {mpLabel}</b> aby wypchnąć zmianę na marketplace.
      </p>
    </div>
  );
}
