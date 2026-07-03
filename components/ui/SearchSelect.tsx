'use client';

/**
 * SearchSelect — select z wbudowaną wyszukiwarką (combobox).
 * Zastępuje natywny <select> tam, gdzie lista wartości bywa długa (np. Empik STR_GOLD).
 * Renderuje listę dopiero po wpisaniu/otwarciu i filtruje po etykiecie; zwraca `code`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

export interface SelectOption { code: string; label: string }

interface Props {
  options: SelectOption[];
  value: string;
  onChange: (code: string) => void;
  className?: string;
  placeholder?: string;
}

const MAX_RENDER = 200; // nie renderujemy tysięcy <li> naraz

export default function SearchSelect({ options, value, onChange, className = 'input', placeholder = '— wybierz —' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => options.find((o) => o.code === value) || null, [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.code.toLowerCase().includes(q)) : options;
    return base.slice(0, MAX_RENDER);
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (code: string) => { onChange(code); setOpen(false); setQuery(''); };

  return (
    <div ref={boxRef} className="relative">
      <button type="button" className={`${className} text-left flex items-center justify-between gap-2`}
        onClick={() => setOpen((o) => !o)}>
        <span className={selected ? '' : 'text-gray-400'}>{selected ? selected.label : placeholder}</span>
        <span className="text-gray-400 shrink-0">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-1.5 border-b border-gray-100">
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input autoFocus className="input w-full text-sm" placeholder="Szukaj…"
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <ul className="max-h-60 overflow-auto py-1 text-sm">
            <li>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-400"
                onClick={() => pick('')}>—</button>
            </li>
            {filtered.map((o) => (
              <li key={o.code}>
                <button type="button"
                  className={`w-full text-left px-3 py-1.5 hover:bg-gray-50 ${o.code === value ? 'bg-blue-50 font-medium' : ''}`}
                  onClick={() => pick(o.code)}>{o.label}</button>
              </li>
            ))}
            {filtered.length === 0 && <li className="px-3 py-1.5 text-gray-400">Brak wyników</li>}
            {!query && options.length > MAX_RENDER && (
              <li className="px-3 py-1.5 text-gray-400 text-xs">Wpisz, aby zawęzić ({options.length} pozycji)…</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
