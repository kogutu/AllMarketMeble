'use client';

/**
 * Panel „Dodawane" — kolejka BULK-obróbki produktów. Pokazuje status każdego wpisu
 * (oczekuje / przetwarza / gotowe / błąd) z odświeżaniem na żywo. Przetwarzanie idzie
 * serwerowym workerem w tle; tu tylko podglądamy postęp.
 */
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';

interface Item {
  id: number; batch_id: string; batch_name: string | null; typesense_id: string; ean: string | null; marketplace: string; status: string;
  draft_id: number | null; title: string | null; error: string | null; updated_at: string;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Oczekuje', cls: 'bg-gray-100 text-gray-600' },
  processing: { label: 'Przetwarza…', cls: 'bg-amber-100 text-amber-700' },
  done: { label: 'Gotowe (szkic)', cls: 'bg-emerald-100 text-emerald-700' },
  published: { label: 'Wystawione', cls: 'bg-blue-100 text-blue-700' },
  error: { label: 'Błąd', cls: 'bg-red-100 text-red-700' },
};

export default function BulkPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [publishing, setPublishing] = useState<Set<number>>(new Set());
  const [published, setPublished] = useState<Set<number>>(new Set());
  const [batchBusy, setBatchBusy] = useState<Set<string>>(new Set());

  // Publikacja szkicu wprost z panelu — trafia do właściwego endpointu wg marketplace.
  const publishItem = async (it: Item, silent = false): Promise<boolean> => {
    if (!it.draft_id) return false;
    setPublishing((p) => new Set(p).add(it.id));
    try {
      const url = it.marketplace === 'allegro'
        ? `/api/allegro/publish/${it.draft_id}`
        : `/api/marketplace/publish/${it.draft_id}`;
      const body = it.marketplace === 'allegro' ? {} : { accountId: it.marketplace };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      const ok = res.ok && (d.success || d.allegroOfferId);
      if (ok) {
        setPublished((p) => new Set(p).add(it.id));
        // Trwałe oznaczenie „wystawione" — pomijane przy „Wystaw wszystkie" po odświeżeniu.
        fetch('/api/bulk-add', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id, action: 'published' }) }).catch(() => {});
        if (!silent) toast.success(`Wystawiono: ${it.title || it.ean || it.typesense_id}`);
      } else if (!silent) {
        toast.error(`Błąd publikacji: ${d.details || d.error || 'nieznany'}`);
      }
      return !!ok;
    } catch (e) {
      if (!silent) toast.error(`Błąd publikacji: ${String(e)}`);
      return false;
    } finally {
      setPublishing((p) => { const n = new Set(p); n.delete(it.id); return n; });
    }
  };

  const load = useCallback(async () => {
    const d = await fetch('/api/bulk-add').then((r) => r.json()).catch(() => null);
    if (d?.items) { setItems(d.items); setCounts(d.counts || {}); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 2500); // odświeżanie na żywo
    return () => clearInterval(t);
  }, [load]);

  const clear = async (scope: 'done' | 'all') => {
    await fetch(`/api/bulk-add?scope=${scope}`, { method: 'DELETE' });
    toast.success(scope === 'all' ? 'Wyczyszczono kolejkę' : 'Usunięto gotowe/wystawione');
    load();
  };
  const removeItem = async (id: number) => {
    await fetch(`/api/bulk-add?id=${id}`, { method: 'DELETE' });
    setItems((prev) => prev.filter((i) => i.id !== id));
  };
  const removeBatch = async (batchId: string) => {
    if (!confirm('Usunąć całą listę z kolejki?')) return;
    await fetch(`/api/bulk-add?batch=${encodeURIComponent(batchId)}`, { method: 'DELETE' });
    setItems((prev) => prev.filter((i) => i.batch_id !== batchId));
  };

  // Publikacja całej nazwanej listy — po kolei publikuje wszystkie gotowe szkice batcha.
  const publishBatch = async (batchId: string, batchItems: Item[]) => {
    const todo = batchItems.filter((i) => i.status === 'done' && i.draft_id && !published.has(i.id));
    if (todo.length === 0) { toast('Brak gotowych szkiców do wystawienia', { icon: 'ℹ️' }); return; }
    setBatchBusy((b) => new Set(b).add(batchId));
    let ok = 0;
    for (const it of todo) { if (await publishItem(it, true)) ok++; }
    setBatchBusy((b) => { const n = new Set(b); n.delete(batchId); return n; });
    if (ok === todo.length) toast.success(`Wystawiono całą listę: ${ok}/${todo.length}`);
    else toast(`Wystawiono ${ok}/${todo.length} — reszta z błędem, sprawdź pozycje`, { icon: '⚠️' });
  };

  const active = (counts.pending || 0) + (counts.processing || 0);

  // Grupowanie po nazwanej liście (batch), z zachowaniem kolejności z API (najnowsze listy u góry).
  const groups: { id: string; name: string; items: Item[] }[] = [];
  const gmap = new Map<string, number>();
  for (const it of items) {
    let gi = gmap.get(it.batch_id);
    if (gi === undefined) { gi = groups.length; gmap.set(it.batch_id, gi); groups.push({ id: it.batch_id, name: it.batch_name || 'Lista', items: [] }); }
    groups[gi].items.push(it);
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Dodawane</h1>
          <p className="text-sm text-gray-500">
            {active > 0 ? `W toku: ${active} · ` : ''}
            Gotowe: {counts.done || 0} · Błędy: {counts.error || 0} · Razem: {items.length}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/products" className="btn-secondary btn-sm">← Produkty</Link>
          <button className="btn-secondary btn-sm" onClick={() => clear('done')}>Usuń gotowe</button>
          <button className="btn-secondary btn-sm text-red-600" onClick={() => clear('all')}>Wyczyść wszystko</button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="card p-10 text-center text-gray-400">Kolejka pusta. Zaznacz produkty na stronie Produkty, nadaj nazwę listy i dodaj do obróbki.</div>
      ) : groups.map((g) => {
        const done = g.items.filter((i) => i.status === 'done').length;
        const err = g.items.filter((i) => i.status === 'error').length;
        const inProg = g.items.length - done - err;
        return (
          <div key={g.id} className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">{g.name}</h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">
                  {inProg > 0 ? `W toku ${inProg} · ` : ''}Gotowe {done}/{g.items.length}{err ? ` · Błędy ${err}` : ''}
                </span>
                {done > 0 && (
                  <button onClick={() => publishBatch(g.id, g.items)} disabled={batchBusy.has(g.id)}
                    className="btn-primary btn-sm text-xs disabled:opacity-50">
                    {batchBusy.has(g.id) ? 'Wystawiam…' : 'Wystaw wszystkie'}
                  </button>
                )}
                <button onClick={() => removeBatch(g.id)} className="text-xs text-red-500 hover:underline">Usuń listę</button>
              </div>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {g.items.map((it) => {
                  const st = STATUS_LABEL[it.status] || STATUS_LABEL.pending;
                  return (
                    <tr key={it.id}>
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-800 line-clamp-1">{it.title || it.ean || it.typesense_id}</div>
                        <div className="text-xs text-gray-400 font-mono">EAN: {it.ean || '—'}</div>
                      </td>
                      <td className="px-3 py-2 capitalize w-24">{it.marketplace}</td>
                      <td className="px-3 py-2 w-36"><span className={`text-xs px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span></td>
                      <td className="px-3 py-2 text-xs text-gray-500 max-w-xs truncate" title={it.error || ''}>{it.error || ''}</td>
                      <td className="px-4 py-2 text-right w-60">
                        <div className="flex items-center justify-end gap-2">
                          {(it.status === 'done' || it.status === 'published') && it.draft_id && (
                            <>
                              <Link href={`/products/${it.typesense_id}/add-to-${it.marketplace}`} className="text-allegro hover:underline text-xs">Otwórz szkic</Link>
                              {(it.status === 'published' || published.has(it.id)) ? (
                                <span className="text-xs text-emerald-600 font-medium">✓ Wystawiono</span>
                              ) : (
                                <button onClick={() => publishItem(it)} disabled={publishing.has(it.id)}
                                  className="btn-primary btn-sm text-xs disabled:opacity-50">
                                  {publishing.has(it.id) ? '…' : 'Wystaw'}
                                </button>
                              )}
                            </>
                          )}
                          <button onClick={() => removeItem(it.id)} title="Usuń z kolejki"
                            className="text-gray-300 hover:text-red-500 text-sm leading-none">✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
