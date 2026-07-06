'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import DataGrid, { ImageCell } from '@/components/grid/DataGrid';
import CategoryChips, { type CategoryOption } from '@/components/products/CategoryChips';
import { listMarketplaces } from '@/lib/marketplaces/catalog';
import type { MebleProduct } from '@/types';

const MARKETPLACES = listMarketplaces();
const PER_PAGE = 250;

type LiveStatus = { listed: boolean; active: boolean };
type DotState = 'active' | 'listed' | 'none';

interface Row {
  id: string;
  image: string;
  name: string;
  sku: string;
  ean: string;
  price: number;
  qty: number;
  kind: string;
  statuses: Record<string, LiveStatus>;
}

// Dedicated CRUD route per marketplace slug.
const CRUD_ROUTE: Record<string, string> = {
  allegro: 'add-to-allegro',
  empik: 'add-to-empik',
  brw: 'add-to-brw',
  kaufland: 'add-to-kaufland',
};

function pickImage(p: MebleProduct): string {
  return p.img || p.gallery_images?.[0] || (p.extra_json?.image as string) || '';
}

// Different-colored dot per marketplace state: active = green, listed = amber, none = faint gray.
const DOT_CLS: Record<string, string> = {
  active: 'bg-green-500',
  listed: 'bg-amber-400',
  none: 'bg-gray-200',
};

/** Full-catalog AG Grid table of products with listed badges and per-marketplace "Wystaw" actions. */
export default function ProductsTable() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  // Dot filters: per-marketplace set of selected states (empty = show all).
  const [dotFilters, setDotFilters] = useState<Record<string, Set<DotState>>>({});
  const toggleDotFilter = (slug: string, state: DotState) =>
    setDotFilters((prev) => {
      const next = new Set(prev[slug] ?? []);
      next.has(state) ? next.delete(state) : next.add(state);
      return { ...prev, [slug]: next };
    });

  // BULK — zaznaczanie wierszy do obróbki jako nazwana lista.
  const [selRows, setSelRows] = useState<Row[]>([]);
  const [bulkMarkets, setBulkMarkets] = useState<string[]>([]);
  const [bulkName, setBulkName] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const submitBulk = async () => {
    if (selRows.length === 0 || bulkMarkets.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch('/api/bulk-add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds: selRows.map((r) => r.id), marketplaces: bulkMarkets, name: bulkName }),
      });
      const d = await res.json();
      if (res.ok) { toast.success(`„${bulkName.trim() || 'Lista'}" — dodano ${d.added} do obróbki (w tle).`, { duration: 6000 }); setBulkName(''); }
      else toast.error(d.error || 'Błąd dodawania do kolejki');
    } finally { setBulkBusy(false); }
  };

  // Category options derived from the loaded catalog (by `kind`), sorted by frequency.
  const categoryOptions = useMemo<CategoryOption[]>(() => {
    const counts = new Map<string, number>();
    for (const r of rows) { if (r.kind) counts.set(r.kind, (counts.get(r.kind) || 0) + 1); }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, label: value, count }));
  }, [rows]);

  const visibleRows = useMemo(() => {
    let result = rows;
    if (selectedCats.length > 0) {
      const set = new Set(selectedCats);
      result = result.filter((r) => set.has(r.kind));
    }
    for (const [slug, states] of Object.entries(dotFilters)) {
      if (states.size === 0) continue;
      result = result.filter((r) => {
        const s = r.statuses?.[slug];
        const state: DotState = s?.active ? 'active' : s?.listed ? 'listed' : 'none';
        return states.has(state);
      });
    }
    return result;
  }, [rows, selectedCats, dotFilters]);

  // One clickable colored-dot cell per marketplace (click → dedicated CRUD route).
  const makeDotCell = useCallback((slug: string, name: string) =>
    ({ data }: ICellRendererParams<Row>) => {
      if (!data) return null;
      const s = data.statuses?.[slug];
      const state = s?.active ? 'active' : s?.listed ? 'listed' : 'none';
      const isPublished = state !== 'none';
      const title = isPublished
        ? `${name}: ${state === 'active' ? 'aktywne' : 'wystawione'} — kliknij, aby edytować`
        : `${name}: brak oferty — kliknij, aby wystawić`;
      const href = isPublished
        ? `/products/${data.id}/${CRUD_ROUTE[slug]}?edit=1`
        : `/products/${data.id}/${CRUD_ROUTE[slug]}`;
      return (
        <button
          onClick={() => router.push(href)}
          title={title}
          className="flex items-center justify-center h-full w-full"
        >
          <span className={`w-3 h-3 rounded-full ${DOT_CLS[state]} ${isPublished ? 'ring-2 ring-offset-1 ring-white shadow' : ''}`} />
        </button>
      );
    }, [router]);

  // Load the whole catalog from Typesense with a progress counter.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const all: MebleProduct[] = [];
      let page = 1;
      let totalPages = 1;
      try {
        do {
          const params = new URLSearchParams({ q: '*', page: String(page), perPage: String(PER_PAGE) });
          const res = await fetch(`/api/products?${params.toString()}`);
          if (!res.ok) break;
          const d = await res.json();
          const hits: MebleProduct[] = d.hits || [];
          all.push(...hits);
          totalPages = d.totalPages || 1;
          if (page === 1) setTotal(d.total || hits.length);
          if (cancelled) return;
          setLoaded(all.length);
          page++;
        } while (page <= totalPages);
      } catch { /* ignore — render what we have */ }
      if (cancelled) return;

      const baseRows: Row[] = all.map((p) => ({
        id: String(p.id),
        image: pickImage(p),
        name: p.name,
        sku: p.sku || '',
        ean: p.ean || '',
        price: p.price_gross || 0,
        qty: p.qty ?? 0,
        kind: p.kind || '',
        statuses: {},
      }));
      setRows(baseRows);
      setLoading(false);

      // Fetch live statuses in chunks and merge.
      const CHUNK = 200;
      for (let i = 0; i < all.length; i += CHUNK) {
        if (cancelled) return;
        const slice = all.slice(i, i + CHUNK);
        try {
          const res = await fetch('/api/marketplace/live-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              typesense_ids: slice.map((p) => p.id),
              eans: slice.map((p) => p.ean).filter(Boolean),
            }),
          });
          const d = await res.json();
          const byTs = d.status || {};
          const byEan = d.statusByEan || {};
          setRows((prev) => {
            const patch = new Map<string, Record<string, LiveStatus>>();
            for (const p of slice) {
              const s = byTs[p.id] || (p.ean && byEan[p.ean]) || null;
              if (s) patch.set(String(p.id), s);
            }
            if (patch.size === 0) return prev;
            return prev.map((r) => (patch.has(r.id) ? { ...r, statuses: patch.get(r.id)! } : r));
          });
        } catch { /* ignore chunk */ }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const columnDefs = useMemo<ColDef<Row>[]>(() => [
    { headerName: '', field: 'image', width: 64, cellRenderer: ImageCell, sortable: false, filter: false, floatingFilter: false },
    { headerName: 'Nazwa', field: 'name', flex: 2, minWidth: 240 },
    { headerName: 'EAN', field: 'ean', width: 160 },
    { headerName: 'Cena', field: 'price', width: 110, valueFormatter: (p) => (p.value != null ? `${Number(p.value).toFixed(2)} zł` : '') },
    { headerName: 'Qty', field: 'qty', width: 90 },
    // One column per marketplace (A | E | B | K) — colored dot by listing state.
    ...MARKETPLACES.map((m): ColDef<Row> => ({
      headerName: m.badge,
      colId: `mp_${m.slug}`,
      width: 70,
      headerTooltip: m.name,
      sortable: true,
      filter: false,
      floatingFilter: false,
      cellRenderer: makeDotCell(m.slug, m.name),
      // Sort by state strength (active > listed > none) and let CSV/XLSX export a readable value.
      valueGetter: (p) => {
        const s = p.data?.statuses?.[m.slug];
        return s?.active ? 'aktywne' : s?.listed ? 'wystawione' : '';
      },
    })),
  ], [makeDotCell]);

  return (
    <div className="space-y-3">
      <CategoryChips
        options={categoryOptions}
        selected={selectedCats}
        onToggle={(v) => setSelectedCats((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))}
        onClear={() => setSelectedCats([])}
      />

      {/* Dot filters */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {MARKETPLACES.map((m) => {
          const active = dotFilters[m.slug] ?? new Set<DotState>();
          return (
            <div key={m.slug} className="flex items-center gap-1">
              <span className="text-xs font-semibold text-gray-500 w-4">{m.badge}</span>
              {([
                { state: 'active' as DotState, cls: 'bg-green-500', title: 'Aktywne' },
                { state: 'listed' as DotState, cls: 'bg-amber-400', title: 'Wystawione' },
                { state: 'none' as DotState, cls: 'bg-gray-200', title: 'Brak' },
              ]).map(({ state, cls, title }) => (
                <button
                  key={state}
                  type="button"
                  title={`${m.name}: ${title}`}
                  onClick={() => toggleDotFilter(m.slug, state)}
                  className={clsx(
                    'w-4 h-4 rounded-full transition-all',
                    cls,
                    active.has(state)
                      ? 'ring-2 ring-offset-1 ring-indigo-500 scale-125'
                      : 'opacity-40 hover:opacity-80',
                  )}
                />
              ))}
            </div>
          );
        })}
        {Object.values(dotFilters).some((s) => s.size > 0) && (
          <button
            type="button"
            onClick={() => setDotFilters({})}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            wyczyść filtry
          </button>
        )}

        {/* Legend */}
        <div className="ml-auto flex items-center gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> aktywne</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> wystawione</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-gray-200 inline-block" /> brak</span>
        </div>
      </div>

      <div className="flex items-center justify-end">
        <div className="text-sm text-gray-500">
          {loading
            ? `Wczytywanie… ${loaded.toLocaleString('pl')}${total ? ` / ${total.toLocaleString('pl')}` : ''}`
            : `${visibleRows.length.toLocaleString('pl')}${selectedCats.length ? ` / ${rows.length.toLocaleString('pl')}` : ''} produktów`}
        </div>
      </div>

      {loading && (
        <div className="h-1 w-full bg-gray-100 rounded overflow-hidden">
          <div className="h-full bg-indigo-500 transition-all"
            style={{ width: total ? `${Math.min(100, (loaded / total) * 100)}%` : '30%' }} />
        </div>
      )}

      <DataGrid<Row>
        rowData={visibleRows}
        columnDefs={columnDefs}
        getRowId={(p) => p.data.id}
        loading={loading}
        pagination={false}
        selectable
        onSelectionChanged={setSelRows}
        exportName="produkty"
        viewKey="produkty-tabela"
        toolbarLeft={
          selRows.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Zaznaczono: {selRows.length}</span>
              <input className="input w-40 text-sm" placeholder="Nazwa listy (np. krzesła)"
                value={bulkName} onChange={(e) => setBulkName(e.target.value)} />
              {MARKETPLACES.map((m) => {
                const on = bulkMarkets.includes(m.slug);
                return (
                  <button key={m.slug} type="button"
                    onClick={() => setBulkMarkets((prev) => on ? prev.filter((x) => x !== m.slug) : [...prev, m.slug])}
                    className={clsx('px-3 py-1 rounded-full text-xs font-medium', on ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
                    {m.name}
                  </button>
                );
              })}
              <button type="button" onClick={submitBulk} disabled={bulkBusy || bulkMarkets.length === 0}
                className="btn-primary btn-sm disabled:opacity-50">
                {bulkBusy ? '…' : `Dodaj do obróbki (${selRows.length})`}
              </button>
              <Link href="/bulk" className="text-sm text-allegro hover:underline">Dodawane →</Link>
            </div>
          ) : <span className="text-xs text-gray-400">Badge: A=Allegro · E=Empik · B=BRW · K=Kaufland · zaznacz wiersze, by dodać do obróbki</span>
        }
      />
    </div>
  );
}
