'use client';

import { useState, useEffect, useCallback } from 'react';
import { AllegroCategory } from '@/types';

interface TreeNode extends AllegroCategory {
  children?: TreeNode[];
  loaded?: boolean;
  expanded?: boolean;
}

interface Props {
  selected: { id: string; name: string }[];
  onChange: (selected: { id: string; name: string }[]) => void;
}

function NodeRow({
  node,
  depth,
  selected,
  onToggleSelect,
  onExpand,
}: {
  node: TreeNode;
  depth: number;
  selected: Set<string>;
  onToggleSelect: (id: string, name: string) => void;
  onExpand: (node: TreeNode) => void;
}) {
  const isSelected = selected.has(node.id);

  return (
    <>
      <div
        className="flex items-center gap-1.5 py-1 px-2 rounded hover:bg-gray-50 cursor-pointer select-none"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {/* Expand toggle */}
        <button
          type="button"
          className="w-4 h-4 flex items-center justify-center text-gray-400 shrink-0"
          onClick={() => onExpand(node)}
        >
          {!node.leaf ? (
            node.expanded ? '▾' : '▸'
          ) : (
            <span className="w-4" />
          )}
        </button>

        {/* Checkbox */}
        <input
          type="checkbox"
          className="accent-allegro shrink-0"
          checked={isSelected}
          onChange={() => onToggleSelect(node.id, node.name)}
        />

        <span
          className="text-sm text-gray-800 flex-1"
          onClick={() => onToggleSelect(node.id, node.name)}
        >
          {node.name}
          {node.leaf && <span className="ml-1 text-xs text-gray-400">(liść)</span>}
        </span>
      </div>

      {node.expanded && node.children && (
        <>
          {node.children.map((child) => (
            <NodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selected={selected}
              onToggleSelect={onToggleSelect}
              onExpand={onExpand}
            />
          ))}
          {node.loaded && node.children.length === 0 && (
            <div style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }} className="py-1 text-xs text-gray-400">
              Brak podkategorii
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function CategoryTreePicker({ selected, onChange }: Props) {
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<AllegroCategory[] | null>(null);
  const [searching, setSearching] = useState(false);

  const selectedSet = new Set(selected.map((s) => s.id));

  useEffect(() => {
    fetch('/api/allegro/categories')
      .then((r) => r.json())
      .then((d) => setRoots((d.categories || []).map((c: AllegroCategory) => ({ ...c }))))
      .finally(() => setLoading(false));
  }, []);

  const expandNode = useCallback(async (node: TreeNode) => {
    if (node.leaf) return;

    // Toggle collapse
    if (node.expanded) {
      setRoots((prev) => toggleExpanded(prev, node.id, false));
      return;
    }

    if (!node.loaded) {
      const res = await fetch(`/api/allegro/categories?parentId=${node.id}`);
      const data = await res.json();
      const children: TreeNode[] = (data.categories || []).map((c: AllegroCategory) => ({ ...c }));
      setRoots((prev) => setChildren(prev, node.id, children));
    } else {
      setRoots((prev) => toggleExpanded(prev, node.id, true));
    }
  }, []);

  const handleSearch = async (phrase: string) => {
    setSearch(phrase);
    if (!phrase.trim()) { setSearchResults(null); return; }
    setSearching(true);
    const res = await fetch(`/api/allegro/categories?phrase=${encodeURIComponent(phrase)}`);
    const data = await res.json();
    setSearchResults(data.categories || []);
    setSearching(false);
  };

  const toggleSelect = (id: string, name: string) => {
    const next = selected.some((s) => s.id === id)
      ? selected.filter((s) => s.id !== id)
      : [...selected, { id, name }];
    onChange(next);
  };

  if (loading) return <div className="text-sm text-gray-400 py-2">Ładowanie kategorii...</div>;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Search */}
      <div className="p-2 border-b border-gray-100 bg-gray-50">
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Szukaj kategorii..."
          className="input text-sm w-full"
        />
      </div>

      {/* Tree or search results */}
      <div className="max-h-64 overflow-y-auto p-1">
        {search ? (
          searching ? (
            <div className="text-sm text-gray-400 p-2">Szukanie...</div>
          ) : (searchResults || []).length === 0 ? (
            <div className="text-sm text-gray-400 p-2">Brak wyników</div>
          ) : (
            (searchResults || []).map((cat) => (
              <div key={cat.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-50">
                <input
                  type="checkbox"
                  className="accent-allegro"
                  checked={selectedSet.has(cat.id)}
                  onChange={() => toggleSelect(cat.id, cat.name)}
                />
                <span className="text-sm text-gray-800 cursor-pointer flex-1" onClick={() => toggleSelect(cat.id, cat.name)}>
                  {cat.name}
                  {cat.parent && <span className="text-gray-400 text-xs ml-1">({cat.parent.name})</span>}
                </span>
              </div>
            ))
          )
        ) : (
          roots.map((node) => (
            <NodeRow
              key={node.id}
              node={node}
              depth={0}
              selected={selectedSet}
              onToggleSelect={toggleSelect}
              onExpand={expandNode}
            />
          ))
        )}
      </div>

      {/* Selected summary */}
      {selected.length > 0 && (
        <div className="border-t border-gray-100 p-2 bg-allegro/5">
          <p className="text-xs font-medium text-allegro mb-1">Wybrane ({selected.length}):</p>
          <div className="flex flex-wrap gap-1">
            {selected.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1 text-xs bg-white border border-allegro/30 text-allegro rounded-full px-2 py-0.5">
                {s.name}
                <button type="button" onClick={() => toggleSelect(s.id, s.name)} className="text-allegro/50 hover:text-allegro">×</button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- tree mutation helpers ---

function toggleExpanded(nodes: TreeNode[], id: string, expanded: boolean): TreeNode[] {
  return nodes.map((n) => {
    if (n.id === id) return { ...n, expanded };
    if (n.children) return { ...n, children: toggleExpanded(n.children, id, expanded) };
    return n;
  });
}

function setChildren(nodes: TreeNode[], id: string, children: TreeNode[]): TreeNode[] {
  return nodes.map((n) => {
    if (n.id === id) return { ...n, children, loaded: true, expanded: true };
    if (n.children) return { ...n, children: setChildren(n.children, id, children) };
    return n;
  });
}
