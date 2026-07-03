/**
 * Pełne drzewo kategorii Allegro dla gałęzi MEBLI, pobierane rekurencyjnie i cache'owane raz dziennie.
 *
 * Po co: `matching-categories` zwraca trafienia z całego Allegro (np. „Konsole" wpada w
 * Motoryzacja/„Deski rozdzielcze, konsole"). Zamiast tego trzymamy lokalnie wszystkie LIŚCIE
 * z poddrzewa „Meble" (root 522) i to z nich budujemy listę kandydatów dla AI.
 *
 * Cache: w pamięci procesu + na dysku (`data_market/allegro_meble_tree.json`), TTL 24h.
 */
import fs from 'fs';
import path from 'path';
import { getCategories } from './allegro';

export interface CategoryLeaf { id: string; name: string; path: string }

const ROOT_ID = process.env.ALLEGRO_FURNITURE_ROOT_ID || '522'; // Dom i Ogród → Meble
const ROOT_NAME = process.env.ALLEGRO_FURNITURE_BRANCH || 'Meble';
const TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_FILE = path.join(process.cwd(), 'data_market', 'allegro_meble_tree.json');

interface TreeCache { fetchedAt: number; rootId: string; leaves: CategoryLeaf[] }
type RawNode = { id: string; name: string; leaf?: boolean };

let mem: TreeCache | null = null;

async function crawl(parentId: string, parentPath: string, out: CategoryLeaf[]): Promise<void> {
  const kids = (await getCategories(parentId)) as RawNode[];
  await Promise.all(
    kids.map(async (k) => {
      if (!k?.id) return;
      const nodePath = parentPath ? `${parentPath}/${k.name}` : k.name;
      if (k.leaf) out.push({ id: k.id, name: k.name, path: nodePath });
      else await crawl(k.id, nodePath, out);
    })
  );
}

function readDisk(): TreeCache | null {
  try {
    const d = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as TreeCache;
    if (d && d.rootId === ROOT_ID && Array.isArray(d.leaves)) return d;
  } catch {
    /* brak pliku / błąd parsowania */
  }
  return null;
}

/** Wszystkie liście (kategorie końcowe) poddrzewa Meble. Cache 24h; `force` wymusza odświeżenie. */
export async function getFurnitureLeaves(force = false): Promise<CategoryLeaf[]> {
  const now = Date.now();
  if (!mem) mem = readDisk();
  if (!force && mem && mem.rootId === ROOT_ID && now - mem.fetchedAt < TTL_MS) return mem.leaves;

  const leaves: CategoryLeaf[] = [];
  await crawl(ROOT_ID, ROOT_NAME, leaves);

  mem = { fetchedAt: now, rootId: ROOT_ID, leaves };
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(mem));
  } catch {
    /* dysk read-only — zostajemy przy cache w pamięci */
  }
  return leaves;
}
