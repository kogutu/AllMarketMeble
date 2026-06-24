'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import DataGrid from '@/components/grid/DataGrid';

interface ErrorRow {
  id: number;
  account_id: string;
  offer_id: number | null;
  allegro_offer_id: string | null;
  error_json: string;
  form_data_snapshot: string | null;
  created_at: string;
  offer_title: string | null;
}

function parseError(raw: string): { summary: string; messages: string } {
  try {
    const m = raw.match(/Allegro API \d+: (.+)/);
    if (m) {
      const obj = JSON.parse(m[1]) as { errors?: { userMessage?: string; message?: string; code?: string }[] };
      const messages = (obj.errors || []).map((e) => e.userMessage || e.message || e.code || '').filter(Boolean);
      return { summary: `Allegro ${raw.match(/\d{3}/)?.[0] || 'API'}`, messages: messages.join(' | ') };
    }
  } catch { /* ignore */ }
  return { summary: raw.slice(0, 80), messages: '' };
}

type Row = ErrorRow & { _summary: string; _messages: string };

export default function ErrorsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/errors')
      .then((r) => r.json())
      .then((d) => setRows((d.errors || []).map((e: ErrorRow) => ({ ...e, ...prefix(parseError(e.error_json)) }))))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = useCallback(async (id: number) => {
    await fetch('/api/errors', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleClear = async () => {
    if (!confirm('Usunąć wszystkie logi błędów?')) return;
    await fetch('/api/errors', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    setRows([]);
  };

  const columnDefs = useMemo<ColDef<Row>[]>(() => [
    { headerName: 'Kiedy', field: 'created_at', width: 160, valueFormatter: (p) => p.value ? new Date(p.value as string).toLocaleString('pl') : '' },
    { headerName: 'Konto', field: 'account_id', width: 130 },
    {
      headerName: 'Oferta', field: 'offer_id', width: 110,
      cellRenderer: (p: ICellRendererParams<Row>) => (p.value
        ? <a className="text-allegro underline" href={`/products/${p.value}/add-to-allegro`}>#{String(p.value)}</a>
        : <span className="text-gray-300">—</span>),
    },
    { headerName: 'Tytuł', field: 'offer_title', width: 240, filter: 'agTextColumnFilter' },
    { headerName: 'Błąd', field: '_summary', width: 130 },
    { headerName: 'Komunikaty', field: '_messages', flex: 1, minWidth: 280, filter: 'agTextColumnFilter', tooltipField: '_messages', wrapText: true, autoHeight: true },
    {
      headerName: '', field: 'id', width: 80, pinned: 'right', sortable: false, filter: false,
      cellRenderer: (p: ICellRendererParams<Row>) => (
        <button className="text-red-500 hover:text-red-700 text-xs" onClick={() => handleDelete(Number(p.value))}>Usuń</button>
      ),
    },
  ], [handleDelete]);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Logi błędów</h1>
          <p className="text-sm text-gray-500">Nieudane próby wystawienia ofert ({rows.length})</p>
        </div>
        {rows.length > 0 && (
          <button onClick={handleClear} className="btn-sm text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">
            Wyczyść wszystko
          </button>
        )}
      </div>
      <DataGrid<Row>
        rowData={rows}
        columnDefs={columnDefs}
        getRowId={(p) => String(p.data.id)}
        loading={loading}
        exportName="bledy"
        viewKey="errors"
        toolbarLeft={<button className="btn-secondary btn-sm" onClick={load}>Odśwież</button>}
      />
    </div>
  );
}

function prefix(p: { summary: string; messages: string }) {
  return { _summary: p.summary, _messages: p.messages };
}
