'use client';

import { useState } from 'react';
import clsx from 'clsx';

export interface CategoryOption { value: string; label: string; count?: number; }

/**
 * Collapsible category filter rendered as small selectable chips/tags.
 * Multi-select; controlled via `selected` + `onToggle`. Used above the products cards and table.
 */
export default function CategoryChips({
  options, selected, onToggle, onClear, defaultOpen = false,
}: {
  options: CategoryOption[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (options.length === 0) return null;
  const selectedSet = new Set(selected);

  return (
    <div className="card p-3 space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-sm font-medium text-gray-700"
      >
        <span className="flex items-center gap-2">
          <svg className={clsx('w-4 h-4 text-gray-400 transition-transform', open && 'rotate-90')}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Kategorie
          {selected.length > 0 && (
            <span className="text-xs font-semibold text-white bg-allegro rounded-full px-2 py-0.5">{selected.length}</span>
          )}
        </span>
        <span className="text-xs text-gray-400">{open ? 'Zwiń' : 'Rozwiń'} · {options.length}</span>
      </button>

      {open && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {selected.length > 0 && (
            <button
              onClick={onClear}
              className="text-xs px-2.5 py-1 rounded-full font-medium bg-gray-100 text-gray-500 hover:bg-gray-200"
            >
              Wyczyść
            </button>
          )}
          {options.map((o) => {
            const active = selectedSet.has(o.value);
            return (
              <button
                key={o.value}
                onClick={() => onToggle(o.value)}
                className={clsx(
                  'text-xs px-2.5 py-1 rounded-full font-medium transition-colors border',
                  active
                    ? 'bg-allegro text-white border-allegro'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                )}
              >
                {o.label}
                {o.count != null && <span className={clsx('ml-1', active ? 'text-white/80' : 'text-gray-400')}>{o.count}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
