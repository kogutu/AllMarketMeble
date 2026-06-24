import type { ColDef } from 'ag-grid-community';

/** Available cell render types shown in the view editor. */
export const CELL_FORMATS: { id: string; label: string }[] = [
  { id: '', label: 'Domyślny (tekst)' },
  { id: 'bool-dot', label: 'Kropka tak/nie (zielona/czerwona)' },
  { id: 'bool-icon', label: 'Ikona ✓ / ✗' },
  { id: 'bool-text', label: 'Tekst Tak / Nie' },
  { id: 'stock', label: 'Stan: tło zielone >0, czerwone =0' },
  { id: 'pos-green', label: 'Zielone gdy > 0' },
  { id: 'allegro-link', label: 'Allegro Link prod.' },
  { id: 'zero-red', label: 'Czerwone gdy 0 / puste' },
  { id: 'price', label: 'Cena (… zł)' },
  { id: 'percent', label: 'Procent (×100 %)' },
  { id: 'badge', label: 'Etykieta (pill)' },
  { id: 'status', label: 'Status oferty (kolorowy)' },
  { id: 'image', label: 'Zdjęcie (miniatura)' },
  { id: 'link', label: 'Link (otwórz)' },
  { id: 'date', label: 'Data / godzina' },
  { id: 'color', label: 'Próbka koloru' },
];

const num = (v: unknown) => { const n = Number(v); return Number.isNaN(n) ? null : n; };
const truthy = (v: unknown) => v === true || v === 1 || ['true', '1', 'tak', 'yes', 'y', 'aktywna', 'available', 'active'].includes(String(v ?? '').toLowerCase());
const isHttp = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v);

interface P { value?: unknown; data?: unknown }

/** Apply a render-format id onto a base column definition. */
export function applyFormat<T>(col: ColDef<T>, fmt?: string): ColDef<T> {
  if (!fmt) return col;
  const center = 'flex items-center justify-center h-full';
  switch (fmt) {
    case 'bool-dot':
      return { ...col, cellRenderer: (p: P) => (
        <span className={center}><span className={`w-3 h-3 rounded-full inline-block ${truthy(p.value) ? 'bg-green-500' : 'bg-red-500'}`} /></span>
      ) };
    case 'bool-icon':
      return { ...col, cellRenderer: (p: P) => (
        <span className={`${center} font-bold ${truthy(p.value) ? 'text-green-600' : 'text-red-500'}`}>{truthy(p.value) ? '✓' : '✗'}</span>
      ) };
    case 'bool-text':
      return { ...col, cellRenderer: (p: P) => (
        <span className={truthy(p.value) ? 'text-green-700' : 'text-gray-500'}>{truthy(p.value) ? 'Tak' : 'Nie'}</span>
      ) };
    case 'stock':
      return { ...col, type: 'rightAligned', cellClassRules: {
        'bg-red-500 text-white font-semibold': (p: P) => num(p.value) === 0 || p.value == null || p.value === '',
        'bg-green-500 text-white font-semibold': (p: P) => (num(p.value) ?? 0) > 0,
      } };
    case 'pos-green':
      return { ...col, type: 'rightAligned', cellClassRules: { 'text-green-600 font-semibold': (p: P) => (num(p.value) ?? 0) > 0 } };
    case 'zero-red':
      return { ...col, cellClassRules: { 'bg-red-500 text-white': (p: P) => num(p.value) === 0 || p.value == null || p.value === '' } };
    case 'price':
      return { ...col, type: 'rightAligned', valueFormatter: (p: { value?: unknown }) => (p.value == null || p.value === '' ? '' : `${Number(p.value).toFixed(2)} zł`) };
    case 'percent':
      return { ...col, type: 'rightAligned', valueFormatter: (p: { value?: unknown }) => (p.value == null || p.value === '' ? '' : `${Math.round(Number(p.value) * 100)}%`) };
    case 'badge':
      return { ...col, cellRenderer: (p: P) => (p.value == null || p.value === ''
        ? <span className="text-gray-300">—</span>
        : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{String(p.value)}</span>) };
    case 'status':
      return { ...col, cellRenderer: (p: P) => {
        const map: Record<string, { label: string; cls: string }> = {
          inactive: { label: 'Nieaktywna', cls: 'bg-gray-100 text-gray-600' },
          active: { label: 'Aktywna', cls: 'bg-green-100 text-green-700' },
          listed: { label: 'Aktywna', cls: 'bg-green-100 text-green-700' },
          activating: { label: 'Draft', cls: 'bg-blue-100 text-blue-700' },
          ended: { label: 'Zakończona', cls: 'bg-amber-100 text-amber-700' },
        };
        const key = String(p.value ?? '').toLowerCase();
        console.log(key);

        if (!key) return <span className="text-gray-300">—</span>;
        const s = map[key] || { label: String(p.value), cls: 'bg-gray-100 text-gray-500' };
        return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>;
      } };
    case 'image':
      return { ...col, sortable: false, filter: false, cellRenderer: (p: P) => (isHttp(p.value)
        // eslint-disable-next-line @next/next/no-img-element
        ? <a href={String(p.value)} target="_blank" rel="noreferrer"><img src={String(p.value)} alt="" className="h-12 w-12 object-contain bg-gray-50 rounded border" /></a>
        : <span className="text-gray-300">—</span>) };
    case 'link':
      return { ...col, cellRenderer: (p: P) => (isHttp(p.value)
        ? <a href={String(p.value)} target="_blank" rel="noreferrer" className="text-indigo-600 underline">otwórz ↗</a>
        : <span className="text-gray-400">{String(p.value ?? '')}</span>) };
    case 'date':
      return { ...col, valueFormatter: (p: { value?: unknown }) => (p.value ? new Date(p.value as string).toLocaleString('pl') : '') };
    case 'color':
      return { ...col, cellRenderer: (p: P) => {
        const v = String(p.value ?? '');
        return v ? <span className="flex items-center gap-2"><span className="w-4 h-4 rounded border" style={{ background: v }} />{v}</span> : <span className="text-gray-300">—</span>;
      } };
    case 'allegro-link':
 return { ...col, cellRenderer: (p: P) => {
        const v = String(p.value ?? '');
        return<a target="_blank" className="underline bg-blue-400 text-blue-600 hover:text-blue-800 visited:text-purple-600" href={`https://allegro.pl/produkt/${v}`}>zobacz</a>
      } };
    default:
      return col;
  }
}
