'use client';

import { useState, useEffect, useRef } from 'react';
import { AllegroCategory } from '@/types';

interface Props {
  value: string;
  valueName: string;
  onChange: (id: string, name: string) => void;
}

type BrowseItem = AllegroCategory & { leaf?: boolean; parent?: { id: string } };

export default function CategoryPicker({ value, valueName, onChange }: Props) {
  const [mode, setMode] = useState<'search' | 'browse'>('search');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AllegroCategory[]>([]);
  const [searching, setSearching] = useState(false);

  // Browse state
  const [browseStack, setBrowseStack] = useState<{ id: string; name: string }[]>([]);
  const [browseItems, setBrowseItems] = useState<BrowseItem[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Debounced search
  useEffect(() => {
    if (mode !== 'search' || query.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/allegro/categories?phrase=${encodeURIComponent(query)}`);
        const data = await r.json();
        setSearchResults(data.categories || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query, mode]);

  // Load browse level
  const loadBrowse = async (parentId?: string) => {
    setBrowseLoading(true);
    try {
      const url = parentId
        ? `/api/allegro/categories?parentId=${encodeURIComponent(parentId)}`
        : '/api/allegro/categories';
      const r = await fetch(url);
      const data = await r.json();
      setBrowseItems(data.categories || []);
    } catch {
      setBrowseItems([]);
    } finally {
      setBrowseLoading(false);
    }
  };

  const openBrowse = () => {
    setMode('browse');
    setBrowseStack([]);
    setBrowseItems([]);
    setOpen(true);
    loadBrowse();
  };

  const browseInto = (item: BrowseItem) => {
    if (item.leaf) {
      select(item);
      return;
    }
    setBrowseStack((prev) => [...prev, { id: item.id, name: item.name }]);
    loadBrowse(item.id);
  };

  const browseBack = (depth: number) => {
    const newStack = browseStack.slice(0, depth);
    setBrowseStack(newStack);
    const parentId = newStack.length > 0 ? newStack[newStack.length - 1].id : undefined;
    loadBrowse(parentId);
  };

  const select = (cat: AllegroCategory) => {
    onChange(cat.id, cat.name);
    setOpen(false);
    setQuery('');
    setSearchResults([]);
  };

  const clear = () => {
    onChange('', '');
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Selected value display */}
      {value ? (
        <div className="flex items-center gap-2 p-2 bg-allegro/5 border border-allegro/30 rounded-lg text-sm">
          <span className="text-allegro font-medium flex-1 truncate">
            {valueName || value}
          </span>
          <span className="text-gray-400 font-mono text-xs shrink-0">#{value}</span>
          <button
            type="button"
            onClick={clear}
            className="text-gray-400 hover:text-red-500 shrink-0 text-base leading-none"
            title="Usuń kategorię"
          >
            ×
          </button>
        </div>
      ) : (
        <div className="text-sm text-amber-600 mb-1">Brak wybranej kategorii</div>
      )}

      {/* Controls */}
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={() => { setMode('search'); setOpen(true); }}
          className="btn-secondary btn-sm flex-1"
        >
          🔍 Szukaj kategorii
        </button>
        <button
          type="button"
          onClick={openBrowse}
          className="btn-secondary btn-sm flex-1"
        >
          🌳 Przeglądaj drzewo
        </button>
      </div>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl">
          {mode === 'search' && (
            <div>
              <div className="p-3 border-b">
                <input
                  autoFocus
                  className="input w-full"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="np. Biurka, Krzesła biurowe, Szafy..."
                />
                {searching && (
                  <p className="text-xs text-gray-400 mt-1">Szukam...</p>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto">
                {searchResults.length === 0 && query.length >= 2 && !searching && (
                  <p className="text-sm text-gray-400 p-3">Brak wyników</p>
                )}
                {searchResults.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0"
                    onClick={() => select(cat)}
                  >
                    <span className="text-sm text-gray-900">{cat.name}</span>
                    <span className="text-xs text-gray-400 ml-2 font-mono">#{cat.id}</span>
                    {(cat as BrowseItem).leaf && (
                      <span className="ml-2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">liść</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === 'browse' && (
            <div>
              {/* Breadcrumb */}
              <div className="flex items-center gap-1 p-3 border-b text-sm flex-wrap">
                <button
                  type="button"
                  className="text-allegro hover:underline"
                  onClick={() => browseBack(0)}
                >
                  Główne
                </button>
                {browseStack.map((item, i) => (
                  <span key={item.id} className="flex items-center gap-1">
                    <span className="text-gray-400">/</span>
                    <button
                      type="button"
                      className="text-allegro hover:underline truncate max-w-[120px]"
                      onClick={() => browseBack(i + 1)}
                    >
                      {item.name}
                    </button>
                  </span>
                ))}
              </div>

              <div className="max-h-64 overflow-y-auto">
                {browseLoading && (
                  <p className="text-sm text-gray-400 p-3">Ładuję...</p>
                )}
                {!browseLoading && browseItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0 flex items-center justify-between"
                    onClick={() => browseInto(item)}
                  >
                    <span className="text-sm text-gray-900">{item.name}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 font-mono">#{item.id}</span>
                      {item.leaf
                        ? <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">liść ✓</span>
                        : <span className="text-xs text-gray-400">›</span>
                      }
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="p-2 border-t bg-gray-50 rounded-b-xl">
            <button
              type="button"
              className="text-xs text-gray-400 hover:text-gray-600"
              onClick={() => setOpen(false)}
            >
              Zamknij
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
