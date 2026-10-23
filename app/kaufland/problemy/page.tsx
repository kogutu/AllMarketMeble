'use client';

// ─────────────────────────────────────────────────────────────────────────────
// KAUFLAND — oferty, które nie docierają do klientów („Invalid” w Seller Center),
// z rozpisanym powodem: czego brakuje albo co Kaufland odrzucił.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import DataGrid from '@/components/grid/DataGrid';
import type { KauflandInvalidRow } from '@/app/api/kaufland/invalid/route';

const BATCH = 50;
const sellerPortal = (ean: string) =>
  `https://sellerportal.kaufland.de/product-data/${encodeURIComponent(ean)}/attributes?storefront=pl`;

/** Grupa problemu → kolor, żeby dało się ogarnąć listę wzrokiem bez czytania każdego wiersza. */
function problemTone(problem: string): string {
  if (!problem) return 'text-gray-400';
  if (problem === 'OK') return 'text-green-700';
  if (/zablokowany|odrzuc/i.test(problem)) return 'text-red-700';
  return 'text-amber-700';
}

export default function KauflandProblemyPage() {
  const [rows, setRows] = useState<KauflandInvalidRow[]>([]);
  const [byKind, setByKind] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [kindFilter, setKindFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch('/api/kaufland/invalid').then((r) => r.json());
      setRows(d.items || []);
      setByKind(d.byKind || {});
    } catch {
      toast.error('Nie udało się wczytać listy');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Pobiera diagnozę z Kauflandu partiami — to jedno żądanie na produkt. */
  const runCheck = async () => {
    if (checking) return;
    setChecking(true);
    try {
      let offset = 0; let done = false; let total = 0;
      do {
        const d: { success?: boolean; processed?: number; total?: number; nextOffset?: number; done?: boolean; error?: string; details?: string } =
          await fetch(`/api/kaufland/invalid?limit=${BATCH}&offset=${offset}`, { method: 'POST' }).then((r) => r.json());
        if (!d.success) { toast.error('Sprawdzanie: ' + (d.details || d.error || 'nieznany błąd')); return; }
        total = d.total || total;
        offset = d.nextOffset ?? offset + BATCH;
        done = !!d.done;
        setProgress({ done: Math.min(offset, total), total });
      } while (!done);
      toast.success('Diagnoza odświeżona');
      await load();
    } catch {
      toast.error('Sprawdzanie: błąd sieci');
    } finally {
      setChecking(false);
      setProgress(null);
    }
  };

  const visible = useMemo(
    () => (kindFilter ? rows.filter((r) => r.kind === kindFilter) : rows),
    [rows, kindFilter]
  );

  const columnDefs = useMemo<ColDef<KauflandInvalidRow>[]>(() => [
    {
      headerName: 'Produkt', field: 'title', pinned: 'left', width: 330, filter: 'agTextColumnFilter',
      cellRenderer: (p: ICellRendererParams<KauflandInvalidRow>) => (
        <div className="flex items-center gap-3 py-1">
          {p.data?.img
            // eslint-disable-next-line @next/next/no-img-element
            ? <a href={p.data.img} target="_blank" rel="noreferrer"><img src={p.data.img} alt="" className="h-12 w-12 object-contain bg-gray-50 rounded border shrink-0" /></a>
            : <div className="h-12 w-12 rounded border border-dashed border-gray-200 shrink-0" />}
          <div className="leading-tight">
            <div className="line-clamp-2 whitespace-normal">{String(p.value || p.data?.ref || '')}</div>
            {p.data?.sku && <div className="text-[11px] text-gray-400 font-mono">{p.data.sku}</div>}
          </div>
        </div>
      ),
    },
    { headerName: 'EAN', field: 'ean', width: 145, filter: 'agTextColumnFilter', cellClass: 'font-mono text-xs' },
    {
      headerName: 'Rodzaj', field: 'kind', width: 140, filter: 'agTextColumnFilter',
      cellRenderer: (p: ICellRendererParams<KauflandInvalidRow>) => (
        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
          p.value === 'Dane produktowe' ? 'bg-red-100 text-red-700'
            : p.value === 'Wstrzymana' ? 'bg-purple-100 text-purple-700'
            : p.value === 'Stan 0' ? 'bg-gray-100 text-gray-600'
            : 'bg-amber-100 text-amber-700'}`}>
          {String(p.value || '')}
        </span>
      ),
    },
    {
      headerName: 'Co jest nie tak', field: 'problems', width: 420, autoHeight: true, sortable: false,
      filter: 'agTextColumnFilter',
      valueFormatter: (p) => ((p.value as string[] | undefined) ?? []).join(' | '),
      cellRenderer: (p: ICellRendererParams<KauflandInvalidRow>) => {
        const list = (p.value as string[] | undefined) ?? [];
        if (list.length === 0) return <span className="text-gray-300 text-xs">—</span>;
        return (
          <ul className={`text-xs leading-snug py-1 space-y-0.5 ${problemTone(p.data?.problem || '')}`}>
            {list.map((t, i) => <li key={i} className="whitespace-normal">• {t}</li>)}
          </ul>
        );
      },
    },
    {
      headerName: 'Zdjęcia', field: 'pictures', width: 100,
      cellRenderer: (p: ICellRendererParams<KauflandInvalidRow>) => {
        const v = String(p.value || '');
        if (!v) return <span className="text-gray-300">—</span>;
        const [ok] = v.split('/');
        return <span className={Number(ok) > 0 ? 'text-green-700' : 'text-red-600 font-semibold'}>{v}</span>;
      },
    },
    {
      headerName: 'GPSR', field: 'gpsr', width: 90,
      cellRenderer: (p: ICellRendererParams<KauflandInvalidRow>) => {
        const v = String(p.value || '');
        if (!v) return <span className="text-gray-300">—</span>;
        return <span className={v === 'jest' ? 'text-green-700' : 'text-amber-700 font-semibold'}>{v}</span>;
      },
    },
    { headerName: 'Cena', field: 'price', width: 95, type: 'rightAligned', filter: 'agNumberColumnFilter' },
    { headerName: 'Ilość', field: 'quantity', width: 85, type: 'rightAligned', filter: 'agNumberColumnFilter' },
    {
      headerName: 'Sprawdzono', field: 'checkedAt', width: 130,
      valueFormatter: (p) => (p.value ? new Date(String(p.value)).toLocaleString('pl') : '—'),
    },
    {
      headerName: 'Akcje', field: 'ref', width: 170, pinned: 'right', sortable: false, filter: false,
      cellRenderer: (p: ICellRendererParams<KauflandInvalidRow>) => (
        <div className="flex items-center gap-2 text-xs">
          {p.data?.typesenseId && (
            <a className="text-indigo-600 underline" href={`/products/${p.data.typesenseId}/add-to-kaufland`}>Popraw</a>
          )}
          {p.data?.ean && (
            <a className="text-green-700 underline" href={sellerPortal(p.data.ean)} target="_blank" rel="noreferrer">Kaufland →</a>
          )}
        </div>
      ),
    },
  ], []);

  const checkedCount = rows.filter((r) => r.checkedAt).length;
  const toolbarLeft = (
    <>
      <h1 className="text-base font-bold text-gray-900 mr-2">
        Kaufland — problemy <span className="text-gray-400 font-normal">({visible.length})</span>
      </h1>
      <button
        className="btn-sm px-3 rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-60"
        onClick={runCheck}
        disabled={checking || loading}
      >
        {checking
          ? `Sprawdzam ${progress?.done ?? 0}/${progress?.total || '?'}…`
          : 'Sprawdź w Kauflandzie'}
      </button>
      <button className="btn-secondary btn-sm" onClick={load} disabled={loading}>Odśwież</button>
      <select className="input w-48 text-sm" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
        <option value="">Wszystkie rodzaje</option>
        {Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
          <option key={k} value={k}>{k} ({n})</option>
        ))}
      </select>
      <a href="/m/kaufland" className="text-xs text-indigo-600 underline">← wszystkie oferty</a>
      <span className="text-xs text-gray-400">zdiagnozowanych: {checkedCount}/{rows.length}</span>
    </>
  );

  return (
    <div className="w-full">
      <DataGrid<KauflandInvalidRow>
        rowData={visible}
        columnDefs={columnDefs}
        getRowId={(p) => String(p.data.ref)}
        loading={loading}
        toolbarLeft={toolbarLeft}
        exportName="kaufland-problemy"
        heightClass="h-[calc(100vh-150px)]"
        rowHeight={74}
      />
      <p className="text-xs text-gray-400 mt-1">
        Lista obejmuje oferty, których Kaufland nie pokazuje klientom. Powód pobierany jest z API
        danych produktowych — po poprawce wyślij dane ponownie z formularza oferty.
      </p>
    </div>
  );
}
