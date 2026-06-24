'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import debounce from 'lodash/debounce';
import clsx from 'clsx';
import { MebleProduct } from '@/types';
import ProductCard from '@/components/products/ProductCard';
import ProductsTable from '@/components/products/ProductsTable';
import CategoryChips, { type CategoryOption } from '@/components/products/CategoryChips';
import Pagination from '@/components/ui/Pagination';
import { MarginRule, matchMargin, applyMargin } from '@/lib/margins';
import { PriceOverride } from '@/app/api/prices/route';
import { listMarketplaces } from '@/lib/marketplaces/catalog';

const MARKETPLACES = listMarketplaces();

interface AllegroAccount {
  account_id: string;
  account_name: string;
}

// offerStatus shape: { [typesense_id]: { [account_id]: { o: string; s: 0|1 } } }
type OfferStatusMap = Record<string, Record<string, { o: string; s: number }>>;

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<MebleProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seasonFilter, setSeasonFilter] = useState('');
  const [conditionFilter, setConditionFilter] = useState('');
  const [allegroAccountFilter, setAllegroAccountFilter] = useState<string>('');   // account_id
  const [marginRules, setMarginRules] = useState<MarginRule[]>([]);
  const [accounts, setAccounts] = useState<AllegroAccount[]>([]);
  const [priceOverrides, setPriceOverrides] = useState<PriceOverride[]>([]);
  const [offerStatus, setOfferStatus] = useState<OfferStatusMap>({});
  const [drafts, setDrafts] = useState<Record<string, boolean>>({});
  // Per-marketplace live status (slug → {listed,active}) keyed by typesense_id.
  const [liveStatus, setLiveStatus] = useState<Record<string, Record<string, { listed: boolean; active: boolean }>>>({});
  // Per-marketplace listed/none filter and listed typesense ids.
  const [mpFilter, setMpFilter] = useState<Record<string, '' | 'listed' | 'none'>>({});
  const [listedIds, setListedIds] = useState<Record<string, string[]>>({});


  const [filteredProducts, setFilteredProducts] = useState<MebleProduct[]>([]);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  // Category filter (raw Typesense `cats` values, e.g. "151_biurka").
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);

  // Persist the chosen view across sessions.
  useEffect(() => {
    const saved = localStorage.getItem('products-view-mode');
    if (saved === 'table' || saved === 'cards') setViewMode(saved);
  }, []);
  useEffect(() => { localStorage.setItem('products-view-mode', viewMode); }, [viewMode]);

  const perPage = 80;

  const loadListedIds = () => {
    for (const m of MARKETPLACES) {
      fetch(`/api/marketplace/listed-ids?slug=${m.slug}&active=1`).then((r) => r.json())
        .then((d) => setListedIds((prev) => ({ ...prev, [m.slug]: d.ids || [] }))).catch(() => { });
    }
  };

  useEffect(() => {
    fetch('/api/margins').then((r) => r.json()).then((d) => setMarginRules(d.rules || [])).catch(() => { });
    fetch('/api/allegro/accounts').then((r) => r.json()).then((d) => setAccounts(d.accounts || [])).catch(() => { });
    loadListedIds();
    // Category facet over the whole catalog (for the chips). Label = strip numeric prefix.
    fetch('/api/products?q=*&perPage=1&facetBy=cats')
      .then((r) => r.json())
      .then((d) => {
        const counts = (d.facets?.[0]?.counts || []) as { value: string; count: number }[];
        const opts: CategoryOption[] = counts.map((c) => ({
          value: c.value,
          label: c.value.includes('_') ? c.value.split('_').slice(1).join('_') : c.value,
          count: c.count,
        }));
        setCategoryOptions(opts);
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    if (products.length === 0) { setPriceOverrides([]); setOfferStatus({}); setDrafts({}); return; }
    const ids = products.map((p) => p.id).join(',');
    fetch(`/api/prices?typesense_ids=${encodeURIComponent(ids)}`)
      .then((r) => r.json())
      .then((d) => setPriceOverrides(d.overrides || []))
      .catch(() => { });

    fetch('/api/offers/statuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: products.map((p) => p.id) }),
    })
      .then((r) => r.json())
      .then((d) => { setOfferStatus(d.offers || {}); setDrafts(d.drafts || {}); })
      .catch(() => { });

    // Live listed/active status (Allegro + Empik) from the persisted DB table.
    fetch('/api/marketplace/live-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typesense_ids: products.map((p) => p.id), eans: products.map((p) => p.ean).filter(Boolean) }),
    })
      .then((r) => r.json())
      .then((d) => {
        const byTs = d.status || {};
        const byEan = d.statusByEan || {};
        const map: Record<string, Record<string, { listed: boolean; active: boolean }>> = {};
        for (const p of products) {
          const s = byTs[p.id] || (p.ean && byEan[p.ean]) || null;
          if (s) map[p.id] = s;
        }
        setLiveStatus(map);
      })
      .catch(() => { });
  }, [products]);

  const fetchProducts = useCallback(
    async (q: string, pg: number, season: string, condition: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q: q || '*', page: String(pg), perPage: String(perPage) });
        const filters: string[] = [];

        // Catalog-wide listed/not-listed filters backed by the persisted DB (listed-ids).
        const addIdFilter = (ids: string[], include: boolean) => {
          if (include) filters.push(ids.length ? `id:[${ids.join(',')}]` : 'id:[__none__]');
          else if (ids.length) filters.push(`id:!=[${ids.join(',')}]`);
        };
        // Per-marketplace listed/not-listed filters (config-driven).
        for (const m of MARKETPLACES) {
          const f = mpFilterRef.current[m.slug];
          if (f === 'listed') addIdFilter(listedIdsRef.current[m.slug] || [], true);
          else if (f === 'none') addIdFilter(listedIdsRef.current[m.slug] || [], false);
        }
        // Allegro per-account filter (local published records).
        if (allegroAccountFilterRef.current) addIdFilter(Object.keys(offerStatusRef.current), true);

        // Category filter (raw `cats` values, array-contains).
        if (categoryFilterRef.current.length) {
          const vals = categoryFilterRef.current.map((v) => '`' + v.replace(/`/g, '') + '`').join(',');
          filters.push(`cats:=[${vals}]`);
        }

        if (filters.length) params.set('filterBy', filters.join(' && '));

        const res = await fetch(`/api/products?${params.toString()}`);
        if (!res.ok) throw new Error('Błąd ładowania produktów');
        const data = await res.json();
        setProducts(data.hits || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      } catch (e) {
        setError(String(e));
        setProducts([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const debouncedFetch = useCallback(
    debounce((q: string, pg: number, season: string, condition: string) => {
      fetchProducts(q, pg, season, condition);
    }, 350),
    [fetchProducts]
  );

  useEffect(() => {
    debouncedFetch(search, page, seasonFilter, conditionFilter);
    return () => debouncedFetch.cancel();
  }, [search, page, seasonFilter, conditionFilter, debouncedFetch]);

  const offerStatusRef = useRef(offerStatus);
  const allegroAccountFilterRef = useRef(allegroAccountFilter);
  const mpFilterRef = useRef(mpFilter);
  const listedIdsRef = useRef(listedIds);
  const categoryFilterRef = useRef(categoryFilter);

  useEffect(() => { offerStatusRef.current = offerStatus; }, [offerStatus]);
  useEffect(() => { allegroAccountFilterRef.current = allegroAccountFilter; }, [allegroAccountFilter]);
  useEffect(() => { mpFilterRef.current = mpFilter; }, [mpFilter]);
  useEffect(() => { listedIdsRef.current = listedIds; }, [listedIds]);
  useEffect(() => { categoryFilterRef.current = categoryFilter; }, [categoryFilter]);

  // Re-fetch from the first page whenever the category selection changes.
  useEffect(() => {
    setPage(1);
    debouncedFetch(search, 1, seasonFilter, conditionFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter]);

  // Re-fetch (server-side, catalog-wide) when a listed/account filter changes.
  useEffect(() => {
    (async () => {
      if (allegroAccountFilter) {
        const d = await fetch('/api/offers/statuses', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account: allegroAccountFilter }),
        }).then((r) => r.json()).catch(() => ({}));
        setOfferStatus(d.offers || {});
      }
      setPage(1);
      debouncedFetch(search, 1, seasonFilter, conditionFilter);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpFilter, allegroAccountFilter]);

  // Server-side filters are authoritative — render products as returned.
  useEffect(() => { setFilteredProducts(products); }, [products]);

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Search & Filters */}
      <div className="card p-4 space-y-3">
        {/* Search row */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Szukaj po nazwie, modelu, SKU, EAN..."
              className="input pl-9"
            />
          </div>

          {/* View toggle: cards (server-paged) vs. table (full catalog AG Grid) */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 shrink-0 self-start">
            {([['cards', 'Kafelki'], ['table', 'Tabela']] as const).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  viewMode === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* Per-marketplace status filters (config-driven) — cards mode only */}
        {viewMode === 'cards' && MARKETPLACES.map((m) => (
          <div key={m.slug} className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-500 mr-1 w-28 shrink-0">{m.name}:</span>
            {([['', 'Wszystkie'], ['listed', 'Wystawione'], ['none', 'Nie wystawione']] as const).map(([v, l]) => (
              <button
                key={v || 'all'}
                onClick={() => setMpFilter((prev) => ({ ...prev, [m.slug]: v }))}
                className={clsx(
                  'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                  (mpFilter[m.slug] || '') === v ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                {l}
              </button>
            ))}
            {m.slug === 'allegro' && accounts.map((a) => (
              <button
                key={a.account_id}
                onClick={() => setAllegroAccountFilter(allegroAccountFilter === a.account_id ? '' : a.account_id)}
                className={clsx(
                  'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                  allegroAccountFilter === a.account_id ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                Konto: {a.account_name}
              </button>
            ))}
          </div>
        ))}

        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            {viewMode === 'table' ? 'Widok tabeli — cały katalog' : loading ? 'Ładowanie...' : `Znaleziono: ${total.toLocaleString('pl')} produktów`}
          </span>
          {viewMode === 'cards' && (search || seasonFilter || conditionFilter || Object.values(mpFilter).some(Boolean) || allegroAccountFilter || categoryFilter.length > 0) && (
            <button
              onClick={() => { setSearch(''); setSeasonFilter(''); setConditionFilter(''); setMpFilter({}); setAllegroAccountFilter(''); setCategoryFilter([]); setPage(1); }}
              className="text-allegro hover:underline"
            >
              Wyczyść filtry
            </button>
          )}
        </div>
      </div>

      {/* Główny filtr kategorii — zwijane chipsy (dotyczy widoku kart; tabela ma własny) */}
      {viewMode === 'cards' && (
        <CategoryChips
          options={categoryOptions}
          selected={categoryFilter}
          onToggle={(v) => setCategoryFilter((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))}
          onClear={() => setCategoryFilter([])}
        />
      )}

      {viewMode === 'table' ? (
        <ProductsTable />
      ) : (
      <>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {/* Products grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="w-full h-32 bg-gray-200 rounded-lg mb-3" />
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="card p-12 text-center">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <p className="text-gray-500">Brak produktów spełniających kryteria</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredProducts.map((product) => {
            const productOfferStatus = offerStatus[product.id] || {};

            const priceAllegro = accounts.map((acc) => {
              const override = priceOverrides.find(
                (o) => o.typesense_id === product.id && o.account_id === acc.account_id
              );
              let price: number | null = null;
              if (override) {
                price = Number(override.price);
              } else {
                const rule = matchMargin(marginRules, product, acc.account_id);
                if (rule) price = applyMargin(product.price_gross || 0, Number(rule.margin_pct));
              }
              return { price, id: acc.account_id, name: acc.account_name };
            });

            return (
              <ProductCard
                key={product.id}
                offerStatus={productOfferStatus}
                hasDraft={!!drafts[product.id]}
                product={product}
                onAddToAllegro={(p) => router.push(`/products/${p.id}/add-to-allegro`)}
                onAddToMirakl={(p) => router.push(`/products/${p.id}/add-to-empik`)}
                onAddToMarketplace={(slug, p) => router.push(`/products/${p.id}/add-to-${slug}`)}
                priceAllegro={priceAllegro}
                statuses={liveStatus[product.id]}
              />
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      )}
      </>
      )}
    </div>
  );
}
