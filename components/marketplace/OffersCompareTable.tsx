'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { getMarketplace, ACCENT_CLASSES } from '@/lib/marketplaces/catalog';

interface Item {
  ref: string;
  ean: string | null;
  marketplace: string;
  title: string | null;
  state: string;
  market: { price: number | null; quantity: number | null };
  base: { typesense_id: string; name: string; img: string; sku: string; ean: string; price: number | null; qty: number | null } | null;
  meta?: { ean?: string | null; stateCode?: string; leadtime?: number; logisticClass?: string; date?: string | null };
  fields?: Record<string, string | number | boolean>;
}

const fmt = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(2));

export default function OffersCompareTable({
  slug,
  editPath,
}: {
  slug: string;
  editPath: (typesenseId: string) => string;
}) {
  const router = useRouter();
  const def = getMarketplace(slug);
  const mpLabel = def?.name ?? slug;
  const engine = def?.engine ?? 'mirakl';
  const accentCls = ACCENT_CLASSES[def?.accent ?? 'indigo'];
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(50);
  const [loading, setLoading] = useState(true);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [baseFilter, setBaseFilter] = useState<'' | 'with' | 'without'>('');
  const [edit, setEdit] = useState<Record<string, { price: string; qty: string }>>({});
  const [savingRef, setSavingRef] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [extraCols, setExtraCols] = useState<string[]>([]);
  const [showColsPanel, setShowColsPanel] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [xmlBusy, setXmlBusy] = useState(false);

  // Empik: wyślij dane ofertowe z feedu XML wprost do Empik (import OF01).
  const pushEmpikXml = async () => {
    if (!confirm('Wysłać dane ofertowe z feedu XML do Empik?')) return;
    setXmlBusy(true);
    try {
      const res = await fetch('/api/marketplace/empik-offers-xml', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await res.json();
      if (res.ok) toast.success(`Wysłano ${d.offers} ofert do Empik (import ${d.importId}).`);
      else toast.error(d.error || 'Błąd wysyłki XML');
    } catch (e) {
      toast.error(`Błąd wysyłki XML: ${String(e)}`);
    } finally { setXmlBusy(false); }
  };

  const accentBtn = `${accentCls.btn} text-white`;

  const load = () => {
    setLoading(true);
    fetch(`/api/marketplace/offers?slug=${slug}&page=${page}&perPage=${perPage}`)
      .then((r) => r.json())
      .then((d) => { setItems(d.items || []); setTotal(d.total || 0); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [slug, page]);

  // Persist live offers to DB so the Products page can mark/filter listed status.
  const runSync = async (force = false) => {
    if (syncing) return;
    // Recency guard: skip auto-sync if synced recently.
    const ls = await fetch(`/api/marketplace/sync-live?slug=${slug}`).then((r) => r.json()).catch(() => ({}));
    setLastSync(ls.lastSync ?? null);
    if (!force && ls.lastSync && Date.now() - new Date(ls.lastSync).getTime() < 15 * 60 * 1000) return;

    setSyncing(true);
    setProgress({ processed: 0, total: 0 });
    try {
      const runStartedAt = Date.now();
      // Allegro: sync every active account; Mirakl/Kaufland: single operator (slug resolves it).
      let accountIds = [''];
      if (engine === 'allegro') {
        const accs = await fetch('/api/allegro/accounts').then((r) => r.json()).then((d) => d.accounts || []).catch(() => []);
        accountIds = accs.filter((a: { is_active: number }) => a.is_active).map((a: { account_id: string }) => a.account_id);
        if (accountIds.length === 0) { toast.error('Brak aktywnych kont Allegro'); return; }
      }

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      let processedTotal = 0;
      let grandTotal = 0;
      for (const accountId of accountIds) {
        let offset = 0;
        let done = false;
        do {
          // Per-chunk retry with backoff (marketplaces rate-limit bursts → 429).
          let res: { error?: string; details?: string; processed?: number; total?: number; nextOffset?: number; done?: boolean } | null = null;
          for (let attempt = 0; attempt < 4; attempt++) {
            res = await fetch(
              `/api/marketplace/sync-live?slug=${slug}&offset=${offset}&limit=100&runStartedAt=${runStartedAt}&accountId=${encodeURIComponent(accountId)}`,
              { method: 'POST' }
            ).then((r) => r.json()).catch(() => ({ error: 'network' }));
            if (!res?.error) break;
            if (attempt < 3) await sleep(3000 * (attempt + 1));
          }
          if (res?.error) { toast.error('Sync: ' + (res.details || res.error)); setSyncing(false); setProgress(null); return; }
          processedTotal += res!.processed || 0;
          grandTotal = Math.max(grandTotal, (res!.total || 0) * accountIds.length);
          setProgress({ processed: processedTotal, total: grandTotal });
          done = !!res!.done;
          offset = res!.nextOffset || offset + 100;
          await sleep(1350); // gentle pacing between chunks
        } while (!done);
      }
      // Remove offers no longer live (not touched this run).
      await fetch(`/api/marketplace/sync-live?slug=${slug}&cleanup=1&runStartedAt=${runStartedAt}`, { method: 'POST' }).catch(() => {});
      setLastSync(new Date(runStartedAt).toISOString());
      toast.success('Zsynchronizowano oferty z bazą');
      load();
    } finally {
      setSyncing(false);
      setProgress(null);
    }
  };

  // Show last sync time on entering (button-driven sync — no auto-run).
  useEffect(() => {
    fetch(`/api/marketplace/sync-live?slug=${slug}`)
      .then((r) => r.json()).then((d) => setLastSync(d.lastSync ?? null)).catch(() => {});
  }, [slug]);

  const priceDiffers = (it: Item) =>
    it.base?.price != null && it.market.price != null && Math.abs(it.base.price - it.market.price) > 0.01;
  const qtyDiffers = (it: Item) =>
    it.base?.qty != null && it.market.quantity != null && it.base.qty !== it.market.quantity;

  const statuses = Array.from(new Set(items.map((it) => it.state))).sort();
  const ql = q.trim().toLowerCase();
  const visible = items.filter((it) => {
    if (onlyDiff && !priceDiffers(it) && !qtyDiffers(it)) return false;
    if (statusFilter && it.state !== statusFilter) return false;
    if (baseFilter === 'with' && !it.base) return false;
    if (baseFilter === 'without' && it.base) return false;
    if (ql && !(`${it.base?.name || ''} ${it.title || ''} ${it.ref} ${it.base?.sku || ''} ${it.ean || ''} ${it.base?.ean || ''}`.toLowerCase().includes(ql))) return false;
    return true;
  }).sort((a, b) => (b.meta?.date || '').localeCompare(a.meta?.date || '')); // najnowsze (data modyfikacji) na górze
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // ── Dynamic columns + XLSX export ──────────────────────────────────────────
  const allColumns = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) if (it.fields) for (const k of Object.keys(it.fields)) set.add(k);
    return Array.from(set).sort();
  }, [items]);
  const toggleCol = (c: string) => setExtraCols((cols) => cols.includes(c) ? cols.filter((x) => x !== c) : [...cols, c]);
  const cell = (it: Item, col: string) => { const v = it.fields?.[col]; return v == null ? '' : String(v); };
  const isImageUrl = (v: string) => /^https?:\/\//i.test(v) && /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(v);

  const exportRow = (it: Item): Record<string, unknown> => ({
    ref: it.ref,
    tytul: it.base?.name || it.title || '',
    ean_baza: it.base?.ean || '',
    cena_baza: it.base?.price ?? '',
    ilosc_baza: it.base?.qty ?? '',
    cena_marketplace: it.market.price ?? '',
    ilosc_marketplace: it.market.quantity ?? '',
    status: it.state,
    ...(it.fields || {}),
  });

  const downloadXlsx = (rows: Record<string, unknown>[], name: string) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, mpLabel);
    XLSX.writeFile(wb, name);
  };

  const exportPage = () => {
    if (visible.length === 0) { toast.error('Brak danych do eksportu'); return; }
    downloadXlsx(visible.map(exportRow), `${slug}-oferty-strona-${page}.xlsx`);
  };

  // Page through ALL offers and export every product value to XLSX.
  const exportAll = async () => {
    if (exporting) return;
    setExporting(true);
    setExportProgress({ done: 0, total });
    try {
      const all: Item[] = [];
      let pg = 1; const pp = 100; let tot = total || 0;
      for (;;) {
        let data: { items?: Item[]; total?: number; error?: string } | null = null;
        for (let a = 0; a < 4; a++) {
          data = await fetch(`/api/marketplace/offers?slug=${slug}&page=${pg}&perPage=${pp}`).then((r) => r.json()).catch(() => null);
          if (data && !data.error) break;
          await new Promise((r) => setTimeout(r, 2000 * (a + 1)));
        }
        const batch = data?.items || [];
        tot = data?.total ?? tot;
        all.push(...batch);
        setExportProgress({ done: all.length, total: tot });
        if (batch.length < pp || (tot && all.length >= tot)) break;
        pg++;
        await new Promise((r) => setTimeout(r, 1350));
      }
      if (all.length === 0) { toast.error('Brak danych do eksportu'); return; }
      downloadXlsx(all.map(exportRow), `${slug}-oferty-wszystko.xlsx`);
      toast.success(`Wyeksportowano ${all.length} ofert`);
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  };

  const startEdit = (it: Item) => setEdit((e) => ({
    ...e, [it.ref]: { price: String(it.market.price ?? it.base?.price ?? ''), qty: String(it.market.quantity ?? '') },
  }));
  const cancelEdit = (ref: string) => setEdit((e) => { const c = { ...e }; delete c[ref]; return c; });

  const saveEdit = async (it: Item) => {
    const e = edit[it.ref];
    if (!e) return;
    setSavingRef(it.ref);
    try {
      const res = await fetch('/api/marketplace/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug, ref: it.ref, price: parseFloat(e.price), quantity: parseInt(e.qty), meta: it.meta,
        }),
      });
      const d = await res.json();
      if (res.ok && d.success) {
        toast.success(`Zaktualizowano ofertę: ${mpLabel}`);
        cancelEdit(it.ref);
        load();
      } else {
        toast.error('Błąd: ' + (d.details || d.error || 'nieznany'));
      }
    } finally {
      setSavingRef(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{mpLabel} — wystawione</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Oferty pobrane z marketplace, porównane z bazą (Typesense). {total.toLocaleString('pl')} ofert.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            {lastSync ? `Ostatnie wczytanie: ${new Date(lastSync).toLocaleString('pl')}` : 'Nie wczytano jeszcze ofert'}
          </span>
          {slug === 'empik' && (
            <button onClick={pushEmpikXml} disabled={xmlBusy}
              className="btn-sm px-4 font-semibold rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60"
              title="Pobierz feed XML i wyślij dane ofertowe do Empik przez API">
              {xmlBusy ? 'Wysyłam…' : 'Wyślij oferty XML → Empik'}
            </button>
          )}
          <button onClick={() => runSync(true)} disabled={syncing}
            className={`btn-sm px-4 font-semibold rounded-md text-white disabled:opacity-60 ${accentBtn}`}>
            {syncing ? 'Wczytuję…' : `Wczytaj oferty z ${mpLabel}`}
          </button>
          <button onClick={load} disabled={loading || syncing} className="btn-secondary btn-sm">
            {loading ? 'Ładowanie…' : 'Odśwież'}
          </button>
          <div className="relative">
            <button onClick={() => setShowColsPanel((v) => !v)} className="btn-secondary btn-sm">
              Kolumny{extraCols.length ? ` (${extraCols.length})` : ''}
            </button>
            {showColsPanel && (
              <div className="absolute right-0 mt-1 z-20 w-72 max-h-80 overflow-auto card p-2 shadow-lg">
                <div className="flex items-center justify-between px-1 pb-1 mb-1 border-b">
                  <span className="text-xs font-semibold text-gray-600">Dodatkowe kolumny</span>
                  {extraCols.length > 0 && (
                    <button onClick={() => setExtraCols([])} className="text-xs text-red-500 hover:underline">Wyczyść</button>
                  )}
                </div>
                {allColumns.length === 0 ? (
                  <p className="text-xs text-gray-400 px-1 py-2">Najpierw wczytaj/odśwież oferty.</p>
                ) : allColumns.map((c) => (
                  <label key={c} className="flex items-center gap-2 px-1 py-0.5 text-xs hover:bg-gray-50 rounded cursor-pointer">
                    <input type="checkbox" checked={extraCols.includes(c)} onChange={() => toggleCol(c)} />
                    <span className="font-mono truncate">{c}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <button onClick={exportPage} disabled={exporting || loading} className="btn-secondary btn-sm">XLSX strona</button>
          <button onClick={exportAll} disabled={exporting || loading}
            className={`btn-sm px-3 rounded-md text-white ${accentBtn} disabled:opacity-60`}>
            {exporting ? `Eksport… ${exportProgress ? `${exportProgress.done}/${exportProgress.total || '?'}` : ''}` : 'Eksport XLSX (wszystko)'}
          </button>
        </div>
      </div>

      {/* Loader + progress wczytywania ofert */}
      {syncing && (
        <div className="card p-4 border border-gray-200 bg-gray-50/40">
          <div className="flex items-center gap-3">
            <span className={`inline-block w-5 h-5 border-2 rounded-full animate-spin ${accentCls.spinner}`} />
            <div className="flex-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-gray-800">Wczytywanie ofert z {mpLabel}…</span>
                <span className="text-gray-600 tabular-nums">
                  {progress ? `${progress.processed.toLocaleString('pl')} / ${(progress.total || 0).toLocaleString('pl')}` : '…'}
                  {progress && progress.total > 0 && (
                    <span className="text-gray-400"> · zostało {Math.max(0, progress.total - progress.processed).toLocaleString('pl')}</span>
                  )}
                </span>
              </div>
              <div className="h-2 w-full bg-gray-200 rounded overflow-hidden mt-1.5">
                <div className={`h-full transition-all ${accentCls.bar}`}
                  style={{ width: `${progress && progress.total > 0 ? Math.min(100, Math.round((progress.processed / progress.total) * 100)) : 5}%` }} />
              </div>
            </div>
            <span className="text-sm font-semibold text-gray-700 tabular-nums w-12 text-right">
              {progress && progress.total > 0 ? `${Math.min(100, Math.round((progress.processed / progress.total) * 100))}%` : ''}
            </span>
          </div>
        </div>
      )}

      {/* Filtry kolumnowe */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <input className="input flex-1 min-w-[200px]" placeholder="Szukaj: nazwa, SKU, ref…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Status: wszystkie</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input w-44" value={baseFilter} onChange={(e) => setBaseFilter(e.target.value as '' | 'with' | 'without')}>
          <option value="">Baza: wszystkie</option>
          <option value="with">Dopasowane do bazy</option>
          <option value="without">Brak w bazie</option>
        </select>
        <label className="text-xs text-gray-600 flex items-center gap-1.5">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
          Tylko różnice z bazą
        </label>
        <span className="text-xs text-gray-400 ml-auto">{visible.length} z {items.length} na stronie</span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Produkt</th>
              <th className="text-left px-3 py-2 font-medium">EAN</th>
              <th className="text-right px-3 py-2 font-medium">Cena baza</th>
              <th className="text-right px-3 py-2 font-medium">Cena {mpLabel}</th>
              <th className="text-right px-3 py-2 font-medium">Ilość baza</th>
              <th className="text-right px-3 py-2 font-medium">Ilość {mpLabel}</th>
              <th className="text-center px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Data ▾</th>
              {extraCols.map((c) => <th key={c} className="text-left px-3 py-2 font-medium whitespace-nowrap">{c}</th>)}
              <th className="text-right px-4 py-2 font-medium">Akcje</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={9 + extraCols.length} className="px-4 py-8 text-center text-gray-400">Ładowanie…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={9 + extraCols.length} className="px-4 py-8 text-center text-gray-400">Brak ofert.</td></tr>
            ) : visible.map((it) => {
              const e = edit[it.ref];
              return (
                <tr key={it.ref} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {it.base?.img && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.base.img} alt="" className="w-9 h-9 object-contain bg-gray-50 rounded shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate max-w-[280px]">{it.base?.name || it.title || it.ref}</p>
                        <p className="text-xs text-gray-400 font-mono truncate">
                          {it.ref}{!it.base && <span className="text-amber-500"> · brak w bazie</span>}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600 whitespace-nowrap">
                    {it.ean || it.base?.ean || <span className="text-amber-500">brak</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">{fmt(it.base?.price)}</td>
                  <td className={`px-3 py-2 text-right ${priceDiffers(it) ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>
                    {e ? (
                      <input className="input py-1 w-24 text-right" value={e.price}
                        onChange={(ev) => setEdit((m) => ({ ...m, [it.ref]: { ...m[it.ref], price: ev.target.value } }))} />
                    ) : fmt(it.market.price)}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">{it.base?.qty ?? '—'}</td>
                  <td className={`px-3 py-2 text-right ${qtyDiffers(it) ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>
                    {e ? (
                      <input className="input py-1 w-20 text-right" value={e.qty}
                        onChange={(ev) => setEdit((m) => ({ ...m, [it.ref]: { ...m[it.ref], qty: ev.target.value } }))} />
                    ) : (it.market.quantity ?? '—')}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{it.state}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                    {it.meta?.date ? new Date(it.meta.date).toLocaleString('pl') : '—'}
                  </td>
                  {extraCols.map((c) => {
                    const v = cell(it, c);
                    return (
                      <td key={c} className="px-3 py-2 text-gray-700 whitespace-nowrap">
                        {isImageUrl(v) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <a href={v} target="_blank" rel="noreferrer">
                            <img src={v} alt="" className="h-12 w-12 object-contain bg-gray-50 rounded border" />
                          </a>
                        ) : (
                          <span className="block truncate max-w-[260px]" title={v}>{v}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2">
                    <div className="flex gap-1 justify-end">
                      {e ? (
                        <>
                          <button onClick={() => saveEdit(it)} disabled={savingRef === it.ref}
                            className={`text-xs px-2 py-1 rounded ${accentBtn}`}>
                            {savingRef === it.ref ? '…' : 'Aktualizuj'}
                          </button>
                          <button onClick={() => cancelEdit(it.ref)} className="text-xs px-2 py-1 text-gray-400 hover:text-gray-600">Anuluj</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(it)} className="text-xs px-2 py-1 text-gray-500 hover:text-gray-800">Cena/Ilość</button>
                          {it.base && (
                            <button onClick={() => router.push(editPath(it.base!.typesense_id))}
                              className="text-xs px-2 py-1 text-gray-500 hover:text-gray-800">Edytuj</button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn-secondary btn-sm disabled:opacity-40">←</button>
          <span className="text-sm text-gray-500">Strona {page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="btn-secondary btn-sm disabled:opacity-40">→</button>
        </div>
      )}
    </div>
  );
}
