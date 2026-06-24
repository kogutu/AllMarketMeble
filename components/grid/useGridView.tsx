'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ColDef } from 'ag-grid-community';

export interface ColView { field: string; label: string; visible: boolean; }

/**
 * Persistent, editable "view" over a set of AG Grid columns (Strapi-like): rename labels,
 * toggle visibility, reorder, add/remove. Stored in localStorage under `gridview:<key>`.
 */
/** Stable column id: explicit colId, else field. Lets fieldless columns (renderers) be tracked too. */
const colKey = <T,>(c: ColDef<T>): string => String(c.colId ?? c.field ?? '');

export function useGridView<T>(key: string | undefined, columnDefs: ColDef<T>[]) {
  const defByField = useMemo(() => {
    const m = new Map<string, ColDef<T>>();
    for (const c of columnDefs) { const id = colKey(c); if (id) m.set(id, c); }
    return m;
  }, [columnDefs]);

  const fieldsKey = useMemo(() => columnDefs.map(colKey).filter(Boolean).join('|'), [columnDefs]);
  const [view, setView] = useState<ColView[] | null>(null);
  const lastFieldsKey = useRef('');

  useEffect(() => {
    if (!key) { setView(null); return; }
    // Reconcile only when the set of available fields changes (e.g. dynamic columns loaded).
    if (lastFieldsKey.current === fieldsKey && view) return;
    lastFieldsKey.current = fieldsKey;
    let saved: ColView[] | null = null;
    try { saved = JSON.parse(localStorage.getItem(`gridview:${key}`) || 'null'); } catch { saved = null; }
    const fields = columnDefs.map(colKey).filter((f) => f && f !== 'undefined');
    const mk = (f: string): ColView => ({ field: f, label: String(defByField.get(f)?.headerName ?? f), visible: !defByField.get(f)?.hide });
    let v: ColView[];
    if (saved && Array.isArray(saved)) {
      const has = new Set(saved.map((s) => s.field));
      v = saved.filter((s) => defByField.has(s.field));
      for (const f of fields) if (!has.has(f)) v.push(mk(f));
    } else {
      v = fields.map(mk);
    }
    setView(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fieldsKey]);

  const persist = (v: ColView[]) => {
    setView(v);
    if (key) { try { localStorage.setItem(`gridview:${key}`, JSON.stringify(v)); } catch { /* quota */ } }
  };
  const reset = () => {
    if (key) { try { localStorage.removeItem(`gridview:${key}`); } catch { /* */ } }
    lastFieldsKey.current = '';
    setView(columnDefs.map((c) => ({ field: colKey(c), label: String(c.headerName ?? colKey(c)), visible: !c.hide })).filter((x) => x.field && x.field !== 'undefined'));
  };

  const applied = useMemo<ColDef<T>[]>(() => {
    if (!view) return columnDefs;
    return view.map((v) => {
      const base = defByField.get(v.field);
      return { ...(base as ColDef<T>), headerName: v.label, hide: !v.visible };
    });
  }, [view, defByField, columnDefs]);

  return { applied, view, persist, reset, defByField };
}

export function GridViewModal({ view, persist, reset, onClose }: {
  view: ColView[];
  persist: (v: ColView[]) => void;
  reset: () => void;
  onClose: () => void;
}) {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= view.length) return;
    const v = view.slice();
    [v[i], v[j]] = [v[j], v[i]];
    persist(v);
  };
  const setLabel = (i: number, label: string) => { const v = view.slice(); v[i] = { ...v[i], label }; persist(v); };
  const setVisible = (i: number, visible: boolean) => { const v = view.slice(); v[i] = { ...v[i], visible }; persist(v); };
  const hidden = view.filter((v) => !v.visible);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-[640px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold text-gray-800">Kreator widoku — kolumny</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">×</button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-1">
          {view.map((c, i) => (
            <div key={c.field} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 border border-transparent">
              <div className="flex flex-col">
                <button onClick={() => move(i, -1)} className="text-gray-400 hover:text-gray-700 leading-none text-xs">▲</button>
                <button onClick={() => move(i, 1)} className="text-gray-400 hover:text-gray-700 leading-none text-xs">▼</button>
              </div>
              <input type="checkbox" checked={c.visible} onChange={(e) => setVisible(i, e.target.checked)} />
              <input className="input py-1 text-sm flex-1" value={c.label} onChange={(e) => setLabel(i, e.target.value)} />
              <span className="text-xs text-gray-400 font-mono w-40 truncate" title={c.field}>{c.field}</span>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between text-sm">
          <span className="text-xs text-gray-400">{view.length - hidden.length} widocznych · {hidden.length} ukrytych</span>
          <div className="flex gap-2">
            <button onClick={reset} className="btn-secondary btn-sm">Reset</button>
            <button onClick={onClose} className="btn-primary btn-sm">Gotowe</button>
          </div>
        </div>
      </div>
    </div>
  );
}
