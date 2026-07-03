'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import DataGrid from '@/components/grid/DataGrid';
import type { AllegroOffer } from '@/types';

interface AccountOfferRow { offer_id: number; account_id: string; allegro_offer_id: string | null; status: string; }

interface Row {
  id: number;
  typesense_id: string;
  title: string;
  sku: string;
  status: string;
  marketplace: string;
  accounts_count: number;
  allegro_offer_id: string;
  price: number | null;
  quantity: number | null;
  created_at: string;
  updated_at: string;
  _enrich: { allegro_offer_id: string; account_id: string } | null;
  live_status: string;
  quality: number | null;
  live_price: number | null;
  live_stock: number | null;
}

function parseForm(fd: unknown): { title?: string; sku?: string } {
  if (!fd) return {};
  if (typeof fd === 'string') { try { return JSON.parse(fd); } catch { return {}; } }
  return fd as { title?: string; sku?: string };
}

function toRow(o: AllegroOffer, accountsMap: Record<number, AccountOfferRow[]>): Row {
  const accs = accountsMap[o.id] || [];
  const first = accs.find((a) => a.allegro_offer_id) || null;
  const form = parseForm(o.form_data);
  const allegroId = first?.allegro_offer_id || o.allegro_offer_id || '';
  return {
    id: o.id, typesense_id: o.typesense_id,
    title: o.title || form.title || '', sku: form.sku || '',
    status: o.status, marketplace: (o as { marketplace?: string }).marketplace || 'allegro',
    accounts_count: accs.length, allegro_offer_id: allegroId,
    price: o.price != null ? Number(o.price) : null, quantity: o.quantity ?? null,
    created_at: o.created_at, updated_at: o.updated_at,
    _enrich: allegroId ? { allegro_offer_id: allegroId, account_id: first?.account_id || o.account_id || '' } : null,
    live_status: '', quality: null, live_price: null, live_stock: null,
  };
}

export default function OffersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const acc: Row[] = [];
      let pg = 1; const pp = 100; let total = 0;
      for (;;) {
        const d = await fetch(`/api/offers?page=${pg}&perPage=${pp}`).then((r) => r.json()).catch(() => null);
        const offers: AllegroOffer[] = d?.offers || [];
        total = d?.total ?? total;
        acc.push(...offers.map((o) => toRow(o, d?.offerAccountsMap || {})));
        if (offers.length < pp || (total && acc.length >= total)) break;
        pg++;
      }
      setRows(acc);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Live enrich (Allegro): quality score, live status/price/stock for published offers.
  const enrich = async () => {
    if (enriching) return;
    const items = rows.filter((r) => r._enrich).map((r) => ({ db_id: r.id, allegro_offer_id: r._enrich!.allegro_offer_id, account_id: r._enrich!.account_id }));
    if (items.length === 0) { toast('Brak wystawionych ofert do wzbogacenia', { icon: 'ℹ️' }); return; }
    setEnriching(true);
    try {
      const d = await fetch('/api/offers/allegro-enrich', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }).then((r) => r.json());
      const enriched: Record<number, { status?: string; quality_score?: number | null; price?: number | null; stock_available?: number | null }> = d.enriched || {};
      setRows((prev) => prev.map((r) => {
        const e = enriched[r.id];
        return e ? { ...r, live_status: e.status || '', quality: e.quality_score ?? null, live_price: e.price ?? null, live_stock: e.stock_available ?? null } : r;
      }));
      toast.success('Wzbogacono danymi live');
    } finally { setEnriching(false); }
  };

  const handleDelete = useCallback(async (id: number) => {
    if (!confirm('Usunąć ten draft/ofertę?')) return;
    const res = await fetch(`/api/offers/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Usunięto'); setRows((prev) => prev.filter((r) => r.id !== id)); }
    else toast.error('Błąd usuwania');
  }, []);

  const handlePublish = useCallback(async (id: number) => {
    const res = await fetch(`/api/allegro/publish/${id}`, { method: 'POST' });
    const d = await res.json();
    if (res.ok) { toast.success(`Wystawiono: ${d.allegroOfferId}`); loadAll(); }
    else toast.error('Błąd: ' + (d.error || 'nieznany'));
  }, [loadAll]);

  const columnDefs = useMemo<ColDef<Row>[]>(() => [
    { headerName: 'Tytuł', field: 'title', flex: 1, minWidth: 240, pinned: 'left', filter: 'agTextColumnFilter' },
    { headerName: 'SKU', field: 'sku', width: 160, filter: 'agTextColumnFilter', cellClass: 'font-mono text-xs' },
    { headerName: 'Status', field: 'status', width: 110 },
    { headerName: 'Rynek', field: 'marketplace', width: 100 },
    { headerName: 'Konta', field: 'accounts_count', width: 90, type: 'rightAligned' },
    { headerName: 'Allegro ID', field: 'allegro_offer_id', width: 150, filter: 'agTextColumnFilter', cellClass: 'font-mono text-xs' },
    { headerName: 'Cena', field: 'price', width: 100, type: 'rightAligned', filter: 'agNumberColumnFilter' },
    { headerName: 'Ilość', field: 'quantity', width: 90, type: 'rightAligned', filter: 'agNumberColumnFilter' },
    { headerName: 'Live status', field: 'live_status', width: 120 },
    { headerName: 'Jakość %', field: 'quality', width: 110, type: 'rightAligned', valueFormatter: (p) => p.value == null ? '' : `${Math.round(Number(p.value) * 100)}%` },
    { headerName: 'Live cena', field: 'live_price', width: 110, type: 'rightAligned' },
    { headerName: 'Live stan', field: 'live_stock', width: 100, type: 'rightAligned' },
    { headerName: 'Utworzono', field: 'created_at', width: 160, filter: 'agDateColumnFilter', valueFormatter: (p) => p.value ? new Date(p.value as string).toLocaleString('pl') : '' },
    { headerName: 'Zmodyfikowano', field: 'updated_at', width: 170, sort: 'desc', sortIndex: 0, filter: 'agDateColumnFilter', valueFormatter: (p) => p.value ? new Date(p.value as string).toLocaleString('pl') : '' },
    {
      headerName: 'Akcje', field: 'id', width: 200, pinned: 'right', sortable: false, filter: false,
      cellRenderer: (p: ICellRendererParams<Row>) => {
        const r = p.data!;
        return (
          <div className="flex gap-2 text-xs">
            <a className="text-allegro underline" href={`/products/${r.typesense_id}/add-to-allegro`}>Edytuj</a>
            {r.status === 'draft' && <button className="text-green-600 hover:underline" onClick={() => handlePublish(r.id)}>Publikuj</button>}
            <button className="text-red-500 hover:underline" onClick={() => handleDelete(r.id)}>Usuń</button>
          </div>
        );
      },
    },
  ], [handleDelete, handlePublish]);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Oferty</h1>
          <p className="text-sm text-gray-500">Drafty i wystawione oferty ({rows.length})</p>
        </div>
      </div>
      <DataGrid<Row>
        rowData={rows}
        columnDefs={columnDefs}
        getRowId={(p) => String(p.data.id)}
        loading={loading}
        exportName="oferty"
        viewKey="offers"
        toolbarLeft={
          <>
            <button className="btn-secondary btn-sm" onClick={loadAll} disabled={loading}>{loading ? 'Ładowanie…' : 'Odśwież'}</button>
            <button className="btn-secondary btn-sm" onClick={enrich} disabled={enriching || loading}>{enriching ? 'Wzbogacam…' : 'Wzbogać (live)'}</button>
          </>
        }
      />
    </div>
  );
}
