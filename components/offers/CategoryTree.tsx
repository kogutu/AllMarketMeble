'use client';

import { useState, useEffect } from 'react';

interface CategoryNode {
  id: string;
  name: string;
  leaf: boolean;
}

interface Props {
  value: string;       // selected categoryId
  valueName: string;
  onChange: (id: string, name: string) => void;
}

const ROOT_PARENT_ID = '257687';

export default function CategoryTree({ value, valueName, onChange }: Props) {
  // Stack of levels: each level is { parentId, items[] }
  const [stack, setStack] = useState<{ parentId: string; name: string; items: CategoryNode[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idSearch, setIdSearch] = useState('');
  const [idSearchLoading, setIdSearchLoading] = useState(false);
  const [idSearchError, setIdSearchError] = useState<string | null>(null);

  // Load root on mount
  useEffect(() => {
    loadLevel(ROOT_PARENT_ID, 'Kategorie');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadLevel = async (parentId: string, levelName: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/allegro/categories?parentId=${encodeURIComponent(parentId)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Błąd API');
      const items: CategoryNode[] = data.categories || [];
      setStack((prev) => {
        // Find if this parentId is already in the stack (navigating back)
        const idx = prev.findIndex((l) => l.parentId === parentId);
        if (idx >= 0) return prev.slice(0, idx + 1).map((l, i) => i === idx ? { ...l, items } : l);
        return [...prev, { parentId, name: levelName, items }];
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const drillDown = (item: CategoryNode) => {
    if (item.leaf) {
      onChange(item.id, item.name);
    } else {
      loadLevel(item.id, item.name);
    }
  };

  const goBack = (depth: number) => {
    setStack((prev) => prev.slice(0, depth + 1));
  };

  const handleIdSearch = async () => {
    const id = idSearch.trim();
    if (!id) return;
    setIdSearchLoading(true);
    setIdSearchError(null);
    try {
      const r = await fetch(`/api/allegro/categories/${encodeURIComponent(id)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Nie znaleziono kategorii');
      const cat = data.category as { id: string; name: string; leaf?: boolean };
      if (!cat?.id) throw new Error('Nieprawidłowa odpowiedź API');
      onChange(cat.id, cat.name);
      setIdSearch('');
    } catch (e) {
      setIdSearchError(String(e).replace('Error: ', ''));
    } finally {
      setIdSearchLoading(false);
    }
  };

  const currentLevel = stack[stack.length - 1];
  const breadcrumb = stack.slice(1); // skip the implicit root level

  return (
    <div className="space-y-2">
      {/* Search by ID */}
      <div className="flex gap-2">
        <input
          className="input text-sm flex-1 font-mono"
          placeholder="Wpisz ID kategorii np. 257695"
          value={idSearch}
          onChange={(e) => { setIdSearch(e.target.value); setIdSearchError(null); }}
          onKeyDown={(e) => e.key === 'Enter' && handleIdSearch()}
        />
        <button
          type="button"
          onClick={handleIdSearch}
          disabled={idSearchLoading || !idSearch.trim()}
          className="btn-secondary btn-sm px-3 shrink-0"
        >
          {idSearchLoading ? '...' : 'Szukaj'}
        </button>
      </div>
      {idSearchError && (
        <p className="text-xs text-red-500 px-1">{idSearchError}</p>
      )}

      {/* Selected value banner */}
      {value && (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm">
          <span className="text-green-700 font-medium flex-1 truncate">{valueName}</span>
          <span className="text-gray-400 font-mono text-xs shrink-0">#{value}</span>
          <button
            type="button"
            className="text-gray-400 hover:text-red-500 shrink-0 text-base leading-none"
            onClick={() => onChange('', '')}
            title="Usuń wybór"
          >
            ×
          </button>
        </div>
      )}

      {/* Breadcrumb navigation */}
      {breadcrumb.length > 0 && (
        <nav className="flex items-center gap-1 text-xs flex-wrap">
          <button
            type="button"
            className="text-allegro hover:underline"
            onClick={() => goBack(0)}
          >
            ↖ Cofnij do głównych
          </button>
          {breadcrumb.map((level, i) => (
            <span key={level.parentId} className="flex items-center gap-1">
              <span className="text-gray-300">/</span>
              <button
                type="button"
                className="text-allegro hover:underline max-w-[130px] truncate"
                onClick={() => goBack(i + 1)}
              >
                {level.name}
              </button>
            </span>
          ))}
        </nav>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-red-500 px-2">{error}</p>
      )}

      {/* Category list */}
      <div className="border border-gray-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
        {loading && (
          <div className="px-4 py-3 text-sm text-gray-400">Ładowanie...</div>
        )}
        {!loading && currentLevel?.items.map((item) => (
          <label
            key={item.id}
            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors ${
              value === item.id ? 'bg-allegro/5 border-l-2 border-l-allegro' : ''
            }`}
          >
            {item.leaf ? (
              <>
                <input
                  type="radio"
                  name="allegro-category"
                  checked={value === item.id}
                  onChange={() => onChange(item.id, item.name)}
                  className="accent-allegro shrink-0"
                />
                <span className="text-sm text-gray-900 flex-1">{item.name}</span>
                <span className="text-xs text-gray-400 font-mono shrink-0">#{item.id}</span>
              </>
            ) : (
              <>
                <span className="w-4 shrink-0" />
                <button
                  type="button"
                  className="text-sm text-gray-900 flex-1 text-left"
                  onClick={() => drillDown(item)}
                >
                  {item.name}
                </button>
                <span className="text-xs text-gray-400 font-mono shrink-0">#{item.id}</span>
                <span className="text-gray-400 text-xs shrink-0">›</span>
              </>
            )}
          </label>
        ))}
        {!loading && currentLevel?.items.length === 0 && (
          <div className="px-4 py-3 text-sm text-gray-400">Brak podkategorii</div>
        )}
      </div>
    </div>
  );
}
