'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { listMarketplaces } from '@/lib/marketplaces/catalog';
import { CELL_FORMATS } from '@/lib/grid/cellFormats';

interface FieldDef { field: string; label: string; }
interface ColView { field: string; label: string; visible: boolean; render?: string; }
interface SavedView { id: number; name: string; columns: ColView[]; is_default: boolean; }

const MARKETPLACES = listMarketplaces();

export default function ViewsPage() {
  const [slug, setSlug] = useState(MARKETPLACES[0]?.slug || 'empik');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('slug');
    if (q && MARKETPLACES.some((m) => m.slug === q)) setSlug(q);
  }, []);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [views, setViews] = useState<SavedView[]>([]);
  const [editing, setEditing] = useState<{ id?: number; name: string; is_default: boolean; columns: ColView[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const labelOf = useCallback((f: string) => fields.find((x) => x.field === f)?.label || f, [fields]);

  const load = useCallback(() => {
    fetch(`/api/marketplace/fields?slug=${slug}`).then((r) => r.json()).then((d) => setFields(d.fields || [])).catch(() => {});
    fetch(`/api/grid-views?slug=${slug}`).then((r) => r.json()).then((d) => setViews(d.views || [])).catch(() => {});
  }, [slug]);
  useEffect(() => { load(); setEditing(null); }, [load]);

  const startNew = () => setEditing({
    name: 'Nowy widok', is_default: false,
    columns: fields.slice(0, 8).map((f) => ({ field: f.field, label: f.label, visible: true })),
  });
  const editExisting = (v: SavedView) => setEditing({ id: v.id, name: v.name, is_default: v.is_default, columns: v.columns.map((c) => ({ ...c })) });

  const setCols = (cols: ColView[]) => setEditing((e) => (e ? { ...e, columns: cols } : e));
  const addCol = (field: string) => editing && setCols([...editing.columns, { field, label: labelOf(field), visible: true }]);
  const removeCol = (i: number) => editing && setCols(editing.columns.filter((_, j) => j !== i));
  const setLabel = (i: number, label: string) => editing && setCols(editing.columns.map((c, j) => (j === i ? { ...c, label } : c)));
  const setVisible = (i: number, visible: boolean) => editing && setCols(editing.columns.map((c, j) => (j === i ? { ...c, visible } : c)));
  const setRender = (i: number, render: string) => editing && setCols(editing.columns.map((c, j) => (j === i ? { ...c, render } : c)));

  const onDrop = (target: number) => {
    if (!editing || dragIdx === null || dragIdx === target) return;
    const cols = editing.columns.slice();
    const [moved] = cols.splice(dragIdx, 1);
    cols.splice(target, 0, moved);
    setCols(cols);
    setDragIdx(null);
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { toast.error('Podaj nazwę widoku'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/grid-views', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, slug, name: editing.name, columns: editing.columns, is_default: editing.is_default }),
      });
      const d = await res.json();
      if (res.ok && d.success) { toast.success('Zapisano widok'); load(); setEditing((e) => (e ? { ...e, id: d.id } : e)); }
      else toast.error('Błąd zapisu: ' + (d.error || ''));
    } finally { setSaving(false); }
  };

  const del = async (id: number) => {
    if (!confirm('Usunąć widok?')) return;
    await fetch(`/api/grid-views?id=${id}`, { method: 'DELETE' });
    toast.success('Usunięto'); load();
    if (editing?.id === id) setEditing(null);
  };

  const includedFields = useMemo(() => new Set((editing?.columns || []).map((c) => c.field)), [editing]);
  const available = fields.filter((f) => !includedFields.has(f.field));

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Widoki tabel</h1>
        <p className="text-sm text-gray-500 mt-0.5">Twórz i nazywaj widoki kolumn — osobno dla każdego marketplace. Przeciągaj, aby zmienić kolejność.</p>
      </div>

      {/* Marketplace selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500">Marketplace:</span>
        {MARKETPLACES.map((m) => (
          <button key={m.slug} onClick={() => setSlug(m.slug)}
            className={`px-3 py-1 rounded-full text-xs font-medium ${slug === m.slug ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {m.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Views list */}
        <div className="card p-3 space-y-1 h-fit">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-gray-700">Widoki ({views.length})</h3>
            <button onClick={startNew} className="btn-primary btn-sm text-xs">+ Nowy</button>
          </div>
          {views.length === 0 && <p className="text-xs text-gray-400 py-2">Brak widoków.</p>}
          {views.map((v) => (
            <div key={v.id} className={`flex items-center justify-between px-2 py-1.5 rounded text-sm cursor-pointer hover:bg-gray-50 ${editing?.id === v.id ? 'bg-indigo-50' : ''}`}
              onClick={() => editExisting(v)}>
              <span className="truncate">{v.name}{v.is_default && <span className="text-amber-500"> ★</span>}</span>
              <button onClick={(e) => { e.stopPropagation(); del(v.id); }} className="text-red-400 hover:text-red-600 text-xs">usuń</button>
            </div>
          ))}
        </div>

        {/* Editor */}
        <div className="col-span-2 card p-4 space-y-3">
          {!editing ? (
            <p className="text-sm text-gray-400 py-8 text-center">Wybierz widok z listy lub utwórz nowy.</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <input className="input flex-1" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Nazwa widoku" />
                <label className="text-xs text-gray-600 flex items-center gap-1.5 shrink-0">
                  <input type="checkbox" checked={editing.is_default} onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })} />
                  Domyślny
                </label>
              </div>

              <div className="space-y-1 max-h-[50vh] overflow-auto">
                {editing.columns.map((c, i) => (
                  <div key={c.field + i} draggable
                    onDragStart={() => setDragIdx(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDrop(i)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded border border-gray-100 bg-white hover:bg-gray-50">
                    <span className="cursor-grab text-gray-300 select-none">⠿</span>
                    <input type="checkbox" checked={c.visible} onChange={(e) => setVisible(i, e.target.checked)} />
                    <input className="input py-1 text-sm flex-1 min-w-[120px]" value={c.label} onChange={(e) => setLabel(i, e.target.value)} />
                    <select className="input py-1 text-xs w-44 shrink-0" value={c.render || ''} onChange={(e) => setRender(i, e.target.value)} title="Typ pola / render">
                      {CELL_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                    <span className="text-xs text-gray-400 font-mono w-36 truncate" title={c.field}>{c.field}</span>
                    <button onClick={() => removeCol(i)} className="text-red-400 hover:text-red-600 text-xs">×</button>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                <select className="input flex-1" value="" onChange={(e) => { if (e.target.value) addCol(e.target.value); }}>
                  <option value="">+ Dodaj kolumnę…</option>
                  {available.map((f) => <option key={f.field} value={f.field}>{f.label} ({f.field})</option>)}
                </select>
                <button onClick={save} disabled={saving} className="btn-primary btn-sm">{saving ? 'Zapisywanie…' : 'Zapisz widok'}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
