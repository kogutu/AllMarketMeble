'use client';

/**
 * Widok drzewa kategorii Allegro (gałąź Meble) w formie rozwijanego accordionu,
 * z podświetleniem aktualnie wybranej kategorii i automatycznym rozwinięciem ścieżki do niej.
 * Źródło: /api/allegro/categories/tree (liście ze ścieżką, cache 24h).
 */
import { useEffect, useMemo, useRef, useState } from 'react';

interface Leaf { id: string; name: string; path: string }

interface TreeNode {
  name: string;
  id?: string;            // ustawione tylko dla liści (kategorie, na które można wystawiać)
  children: Map<string, TreeNode>;
}

interface Props {
  value: string;                                   // wybrane categoryId
  onChange: (id: string, name: string) => void;
}

function buildTree(leaves: Leaf[]): TreeNode {
  const root: TreeNode = { name: '', children: new Map() };
  for (const leaf of leaves) {
    const parts = leaf.path.split('/').filter(Boolean);
    let node = root;
    parts.forEach((part, i) => {
      let child = node.children.get(part);
      if (!child) { child = { name: part, children: new Map() }; node.children.set(part, child); }
      if (i === parts.length - 1) child.id = leaf.id;
      node = child;
    });
  }
  return root;
}

/** Ścieżka (nazwy węzłów) prowadząca do liścia o danym id — do auto-rozwinięcia. */
function pathToId(leaves: Leaf[], id: string): string[] {
  const leaf = leaves.find((l) => l.id === id);
  return leaf ? leaf.path.split('/').filter(Boolean) : [];
}

function NodeRow({ node, depth, selectedId, expanded, toggle, onPick }: {
  node: TreeNode; depth: number; selectedId: string;
  expanded: Set<string>; toggle: (key: string) => void;
  onPick: (id: string, name: string) => void;
}) {
  const children = useMemo(() => Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name, 'pl')), [node]);
  const isLeaf = node.children.size === 0;
  const key = `${depth}:${node.name}:${node.id ?? ''}`;
  const isOpen = expanded.has(key);
  const isSelected = !!node.id && node.id === selectedId;

  // Po wyrenderowaniu/zaznaczeniu przewiń wybraną kategorię do widoku (w obrębie kontenera drzewa).
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isSelected) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isSelected]);

  return (
    <div>
      <div
        ref={rowRef}
        className={`flex items-center gap-1 py-1 pr-2 rounded cursor-pointer text-sm ${isSelected ? 'bg-blue-100 text-blue-800 font-medium' : 'hover:bg-gray-50'}`}
        style={{ paddingLeft: depth * 14 + 4 }}
        onClick={() => (isLeaf ? node.id && onPick(node.id, node.name) : toggle(key))}
      >
        {!isLeaf ? (
          <span className="w-4 text-gray-400 select-none">{isOpen ? '▾' : '▸'}</span>
        ) : (
          <span className="w-4 text-center text-gray-300 select-none">{isSelected ? '●' : '·'}</span>
        )}
        <span className="flex-1">{node.name}</span>
        {isLeaf && node.id && <span className="text-[11px] text-gray-400 font-mono">#{node.id}</span>}
      </div>
      {!isLeaf && isOpen && children.map((c) => (
        <NodeRow key={`${depth}:${c.name}:${c.id ?? ''}`} node={c} depth={depth + 1}
          selectedId={selectedId} expanded={expanded} toggle={toggle} onPick={onPick} />
      ))}
    </div>
  );
}

export default function CategoryAccordion({ value, onChange }: Props) {
  const [leaves, setLeaves] = useState<Leaf[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/allegro/categories/tree')
      .then((r) => r.json())
      .then((d) => { if (d.leaves) setLeaves(d.leaves); else setError(d.error || 'Błąd ładowania'); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Auto-rozwinięcie ścieżki do wybranej kategorii.
  useEffect(() => {
    if (!value || leaves.length === 0) return;
    const parts = pathToId(leaves, value);
    setExpanded((prev) => {
      const next = new Set(prev);
      parts.slice(0, -1).forEach((_, i) => next.add(`${i}:${parts[i]}:`));
      return next;
    });
  }, [value, leaves]);

  const filteredLeaves = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return leaves;
    return leaves.filter((l) => l.path.toLowerCase().includes(q));
  }, [leaves, filter]);

  const tree = useMemo(() => buildTree(filteredLeaves), [filteredLeaves]);
  const roots = useMemo(() => Array.from(tree.children.values()).sort((a, b) => a.name.localeCompare(b.name, 'pl')), [tree]);

  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Podczas filtrowania rozwijamy wszystko, żeby wyniki były widoczne.
  const effectiveExpanded = filter.trim() ? expandAll(roots) : expanded;

  if (loading) return <div className="text-sm text-gray-400">Ładowanie drzewa kategorii…</div>;
  if (error) return <div className="text-sm text-red-500">{error}</div>;

  return (
    <div className="space-y-2">
      <input className="input text-sm w-full" placeholder="Filtruj kategorie…"
        value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="max-h-72 overflow-auto border border-gray-200 rounded-lg p-1">
        {roots.length === 0 ? (
          <div className="text-sm text-gray-400 px-2 py-1">Brak kategorii</div>
        ) : roots.map((n) => (
          <NodeRow key={`0:${n.name}:${n.id ?? ''}`} node={n} depth={0}
            selectedId={value} expanded={effectiveExpanded} toggle={toggle} onPick={onChange} />
        ))}
      </div>
    </div>
  );
}

/** Zbiór kluczy wszystkich węzłów-rodziców (do rozwinięcia całości przy filtrowaniu). */
function expandAll(roots: TreeNode[]): Set<string> {
  const keys = new Set<string>();
  const walk = (node: TreeNode, depth: number) => {
    if (node.children.size === 0) return;
    keys.add(`${depth}:${node.name}:${node.id ?? ''}`);
    node.children.forEach((c) => walk(c, depth + 1));
  };
  roots.forEach((r) => walk(r, 0));
  return keys;
}
