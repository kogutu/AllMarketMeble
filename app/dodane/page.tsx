'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import DataGrid from '@/components/grid/DataGrid';
import { listMarketplaces } from '@/lib/marketplaces/catalog';
import type { AddedRow } from '@/app/api/marketplace/added/route';

const MARKETPLACES = listMarketplaces();

const STATUS_LABEL: Record<string, string> = {
  draft: 'Szkic', pending: 'Oczekuje', active: 'Aktywna', ended: 'Zakończona', error: 'Błąd',
};
const STATUS_CLS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-500',
  pending: 'bg-amber-100 text-amber-700',
  active: 'bg-green-100 text-green-700',
  ended: 'bg-gray-200 text-gray-600',
  error: 'bg-red-100 text-red-700',
};

export default function DodanePage() {
  const [rows, setRows] = useState<AddedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [marketFilter, setMarketFilter] = useState<string>('');     // '' = wszystkie
  const [errorsById, setErrorsById] = useState<Record<number, string[]>>({});
  const [loadingErr, setLoadingErr] = useState<Record<number, boolean>>({});

  useEffect(() => {
    fetch('/api/marketplace/added')
      .then((r) => r.json())
      .then((d) => setRows(d.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  const fetchErrors = useCallback(async (id: number) => {
    setLoadingErr((p) => ({ ...p, [id]: true }));
    try {
      const r = await fetch('/api/marketplace/added/errors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const d = await r.json();
      setErrorsById((p) => ({ ...p, [id]: d.errors?.length ? d.errors : ['(brak zgłoszonych błędów)'] }));
    } catch {
      setErrorsById((p) => ({ ...p, [id]: ['Błąd pobierania raportu'] }));
    } finally {
      setLoadingErr((p) => ({ ...p, [id]: false }));
    }
  }, []);

  const StatusCell = useCallback(({ value }: ICellRendererParams<AddedRow>) => {
    const s = String(value ?? '');
    return <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded', STATUS_CLS[s] || 'bg-gray-100 text-gray-500')}>
      {STATUS_LABEL[s] || s}
    </span>;
  }, []);

  const ErrorsCell = useCallback(({ data }: ICellRendererParams<AddedRow>) => {
    if (!data) return null;
    const live = errorsById[data.id];
    const text = live ? live.join(' · ') : data.error || '';
    const canFetch = data.engine === 'mirakl' && (data.productImportId || data.offerImportId);
    return (
      <div className="flex items-center gap-2 h-full w-full">
        <span className={clsx('text-xs truncate flex-1', text ? 'text-red-600' : 'text-gray-300')}
          title={text || 'brak'}>
          {text || '—'}
        </span>
        {canFetch && (
          <button
            onClick={() => fetchErrors(data.id)}
            disabled={loadingErr[data.id]}
            className="text-[11px] px-2 py-0.5 rounded border border-gray-200 hover:bg-gray-100 text-gray-600 shrink-0"
          >
            {loadingErr[data.id] ? '…' : 'Pobierz'}
          </button>
        )}
      </div>
    );
  }, [errorsById, loadingErr, fetchErrors]);

  const visibleRows = useMemo(
    () => (marketFilter ? rows.filter((r) => r.slug === marketFilter) : rows),
    [rows, marketFilter]
  );

  const columnDefs = useMemo<ColDef<AddedRow>[]>(() => [
    { headerName: 'Market', field: 'market', width: 150 },
    { headerName: 'SKU', field: 'sku', flex: 1, minWidth: 200 },
    { headerName: 'EAN', field: 'ean', width: 160 },
    { headerName: 'Status', field: 'status', width: 130, cellRenderer: StatusCell },
    { headerName: 'Błędy', colId: 'errors', flex: 1.5, minWidth: 280, cellRenderer: ErrorsCell, sortable: false, filter: false, floatingFilter: false },
  ], [StatusCell, ErrorsCell]);

  // Bulk-fetch errors for pending/error Mirakl rows currently visible (gentle, sequential).
  const fetchAllErrors = async () => {
    const targets = visibleRows.filter((r) => r.engine === 'mirakl' && (r.status === 'error' || r.status === 'pending')
      && (r.productImportId || r.offerImportId));
    for (const r of targets) { await fetchErrors(r.id); }
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Dodane — oferty per marketplace</h1>
        <div className="text-sm text-gray-500">{loading ? 'Wczytywanie…' : `${visibleRows.length.toLocaleString('pl')} ofert`}</div>
      </div>

      {/* Filtr per marketplace */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setMarketFilter('')}
          className={clsx('px-3 py-1 rounded-full text-xs font-medium', marketFilter === '' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
          Wszystkie
        </button>
        {MARKETPLACES.map((m) => (
          <button key={m.slug} onClick={() => setMarketFilter(m.slug)}
            className={clsx('px-3 py-1 rounded-full text-xs font-medium', marketFilter === m.slug ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
            {m.name}
          </button>
        ))}
        <button onClick={fetchAllErrors}
          className="ml-auto text-xs px-3 py-1 rounded-md border border-gray-200 hover:bg-gray-100 text-gray-700">
          Pobierz błędy (oczekujące/błędne)
        </button>
      </div>

      <DataGrid<AddedRow>
        rowData={visibleRows}
        columnDefs={columnDefs}
        getRowId={(p) => String(p.data.id)}
        loading={loading}
        pagination={false}
        exportName="dodane"
        viewKey="dodane"
      />
    </div>
  );
}
