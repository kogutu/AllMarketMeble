'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { TyreProduct, AllegroFormData, ValidationResult } from '@/types';
import { AllegroParamDef } from '@/lib/allegro';
import ValidationPanel from './ValidationPanel';
import DescriptionEditor from './DescriptionEditor';
import ImageGalleryPicker from './ImageGalleryPicker';
import CategoryAccordion from './CategoryAccordion';
import CrudOverlay from '@/components/marketplace/crud/CrudOverlay';

interface Props {
  product: TyreProduct;
  onPublished?: () => void;
  accountPrices?: Record<string, number>;
}

const EMPTY_FORM: AllegroFormData = {
  title: '',
  sku: '',
  categoryId: '',
  categoryName: '',
  description: '',
  price: 0,
  quantity: 1,
  quantity_in_set: 1,
  condition: 'USED',
  invoice: 'VAT_MARGIN',
  images: [],
  shippingCost: 25,
  shippingTime: 'PT24H',
  params: {},
};

// ─── Helper components ────────────────────────────────────────────────────────

function JsonHighlight({ value }: { value: object }) {
  const json = JSON.stringify(value, null, 2);
  const html = json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (m) => {
        if (/^"/.test(m)) return /:$/.test(m) ? `<span style="color:#7dd3fc">${m}</span>` : `<span style="color:#86efac">${m}</span>`;
        if (/true|false/.test(m)) return `<span style="color:#fbbf24">${m}</span>`;
        if (/null/.test(m)) return `<span style="color:#f87171">${m}</span>`;
        return `<span style="color:#c4b5fd">${m}</span>`;
      }
    );
  return <code dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Single-choice dictionary field. Shows a search filter for large dicts. */
function SingleDictField({
  param, value, onChange, proposal, onProposalChange,
}: {
  param: AllegroParamDef;
  value: string;
  onChange: (v: string) => void;
  proposal?: string;
  onProposalChange?: (v: string) => void;
}) {
  const [search, setSearch] = useState('');
  const dict = param.dictionary || [];
  const isLarge = dict.length > 25;
  const filtered = isLarge && search
    ? dict.filter((d) => d.value.toLowerCase().includes(search.toLowerCase()))
    : dict;
  const [forceProposal, setForceProposal] = useState(!!proposal);
  const selectedEntry = dict.find((d) => d.id === value);
  const selectedLabel = selectedEntry?.value;
  // Show proposal when: API flag set, OR entry text looks like "catch-all" (Inny/Other/…), OR user opened manually
  const needsProposal = !!selectedEntry?.requiresProposal
    || /\b(inn[aey]|other|inaczej|pozostał)\b/i.test(selectedEntry?.value ?? '')
    || (!!proposal && proposal.length > 0)
    || forceProposal;

  return (
    <div className="space-y-1">
      {isLarge && (
        <input
          className="input text-sm py-1"
          placeholder="Szukaj..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      {isLarge && selectedLabel && (
        <p className="text-xs text-green-700 px-1">✓ {selectedLabel}</p>
      )}
      <select
        className="input"
        value={value}
        onChange={(e) => { onChange(e.target.value); setSearch(''); }}
        size={isLarge ? Math.min(6, filtered.length + 1) : 1}
      >
        <option value="">Wybierz...</option>
        {filtered.map((d) => (
          <option key={d.id} value={d.id}>{d.value}</option>
        ))}
      </select>
      {value && !needsProposal && (
        <button
          type="button"
          onClick={() => setForceProposal(true)}
          className="text-xs text-gray-400 hover:text-gray-600 mt-0.5"
        >
          + Podaj własną wartość
        </button>
      )}
      {needsProposal && (
        <div className="mt-1">
          <div className="flex items-center justify-between mb-0.5">
            <p className="text-xs text-amber-600 font-medium">
              {selectedEntry?.requiresProposal || /\b(inn[aey]|other|inaczej|pozostał)\b/i.test(selectedEntry?.value ?? '')
                ? 'Allegro wymaga własnej wartości dla tej opcji'
                : 'Własna wartość (opcjonalnie)'}
            </p>
            {forceProposal && !selectedEntry?.requiresProposal && (
              <button type="button" onClick={() => { setForceProposal(false); onProposalChange?.(''); }} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
            )}
          </div>
          <input
            className="input text-sm border-amber-300 focus:ring-amber-400"
            placeholder={`Np. "${selectedLabel ? selectedLabel.replace(/inny|inne|inna|other/i, '').trim() || selectedLabel : ''}…"`}
            value={proposal ?? ''}
            onChange={(e) => onProposalChange?.(e.target.value)}
            autoFocus={forceProposal}
          />
          <p className="text-xs text-amber-600 mt-0.5">Allegro wymaga własnej wartości dla tej opcji</p>
        </div>
      )}
    </div>
  );
}

/** Multi-choice dictionary field — scrollable checkboxes with search. */
function MultiDictField({
  param, value, onChange,
}: { param: AllegroParamDef; value: string[]; onChange: (v: string[]) => void }) {
  const [search, setSearch] = useState('');
  const dict = param.dictionary || [];
  const filtered = search
    ? dict.filter((d) => d.value.toLowerCase().includes(search.toLowerCase()))
    : dict;

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  return (
    <div className="space-y-1">
      {dict.length > 8 && (
        <input
          className="input text-sm py-1"
          placeholder="Szukaj..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto divide-y divide-gray-50">
        {filtered.map((d) => (
          <label key={d.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
            <input
              type="checkbox"
              checked={value.includes(d.id)}
              onChange={() => toggle(d.id)}
              className="accent-allegro w-3.5 h-3.5 shrink-0"
            />
            <span className="text-sm text-gray-800">{d.value}</span>
          </label>
        ))}
        {filtered.length === 0 && (
          <p className="px-3 py-2 text-sm text-gray-400">Brak wyników</p>
        )}
      </div>
      {value.length > 0 && (
        <p className="text-xs text-gray-500">Wybrano: {value.length}</p>
      )}
    </div>
  );
}

/** Renders the right input for a given Allegro param type. */
function ParamField({
  param, value, onChange, proposal, onProposalChange,
}: {
  param: AllegroParamDef;
  value: string | string[];
  onChange: (v: string | string[]) => void;
  proposal?: string;
  onProposalChange?: (v: string) => void;
}) {
  const isMultiple = param.restrictions?.multipleChoices;

  if (param.type === 'dictionary') {
    if (isMultiple) {
      return (
        <MultiDictField
          param={param}
          value={Array.isArray(value) ? value : value ? [value] : []}
          onChange={onChange}
        />
      );
    }
    return (
      <SingleDictField
        param={param}
        value={Array.isArray(value) ? value[0] ?? '' : value}
        onChange={onChange}
        proposal={proposal}
        onProposalChange={onProposalChange}
      />
    );
  }

  const strVal = Array.isArray(value) ? value[0] ?? '' : value;

  if (param.type === 'integer') {
    const r = param.restrictions;
    return (
      <input
        className="input"
        type="number"
        step="1"
        min={r?.min}
        max={r?.max}
        value={strVal}
        onChange={(e) => onChange(e.target.value)}
        placeholder={r ? `${r.min ?? ''}–${r.max ?? ''}` : ''}
      />
    );
  }

  if (param.type === 'float') {
    const r = param.restrictions;
    return (
      <input
        className="input"
        type="number"
        step={r?.precision ? String(Math.pow(10, -r.precision)) : '0.01'}
        min={r?.min}
        max={r?.max}
        value={strVal}
        onChange={(e) => onChange(e.target.value)}
        placeholder={r ? `${r.min ?? ''}–${r.max ?? ''}` : ''}
      />
    );
  }

  // string
  const r = param.restrictions;
  return (
    <input
      className="input"
      type="text"
      value={strVal}
      onChange={(e) => onChange(e.target.value)}
      maxLength={r?.maxLength}
      placeholder={r?.maxLength ? `maks. ${r.maxLength} znaków` : ''}
    />
  );
}

function parseAllegroErrors(details: string | undefined): string[] {
  if (!details) return [];
  const idx = details.indexOf(': ');
  if (idx < 0) return [details];
  try {
    const parsed = JSON.parse(details.slice(idx + 2)) as { errors?: { userMessage?: string; message?: string; code?: string }[] };
    const msgs = (parsed.errors || []).map((e) => e.userMessage || e.message || e.code || '').filter(Boolean);
    return msgs.length > 0 ? msgs : [details];
  } catch {
    return [details];
  }
}

interface CategoryMismatch {
  existingCategoryId: string;
  existingCategoryName: string;
}

function parseCategoryMismatch(details: string | undefined): CategoryMismatch | null {
  if (!details) return null;
  try {
    const idx = details.indexOf(': ');
    const json = JSON.parse(idx >= 0 ? details.slice(idx + 2) : details) as {
      errors?: { code?: string; metadata?: Record<string, string> }[];
    };
    const err = (json.errors || []).find((e) => e.code === 'CATEGORY_MISMATCH');
    if (!err?.metadata?.existingCategoryId) return null;
    return {
      existingCategoryId: err.metadata.existingCategoryId,
      existingCategoryName: err.metadata.existingCategoryName || err.metadata.existingCategoryId,
    };
  } catch {
    return null;
  }
}

/**
 * Fraza do wyszukiwania kategorii Allegro dla MEBLI.
 * Wcześniej budowana z wymiarów opony (width/profile/R diameter) — dla mebli dawało to śmieci
 * i podpowiadało kategorie oponiarskie. Teraz korzystamy z nazwy/modelu/marki produktu.
 */
function furnitureSearchPhrase(product: TyreProduct): string {
  const phrase = [product.name, product.model, product.brand]
    .filter(Boolean)
    .join(' ')
    .trim();
  return phrase || product.kind || 'mebel';
}

// ─── Param pre-fill from product data ────────────────────────────────────────

function prefillParamsFromProduct(
  categoryParams: AllegroParamDef[],
  product: TyreProduct
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};

  for (const p of categoryParams) {
    const n = p.name.toLowerCase();
    const dict = p.dictionary || [];
    const findId = (val: string) => {
      const q = val.toLowerCase().trim();
      return dict.find((d) => d.value.toLowerCase() === q)?.id ?? '';
    };

    if (p.type === 'dictionary') {
      let found = '';
      if (n.includes('marka') || n.includes('producent')) found = findId(product.brand || '');
      else if (n.includes('model')) found = findId(product.model || '');
      else if (n.includes('szerokość')) found = findId(product.width || '');
      else if (n.includes('profil')) found = findId(product.profile || '');
      else if (n.includes('średnica')) found = findId(product.diameter || '');
      else if (n.includes('indeks prędkości')) found = findId((product.speed_index || '').toUpperCase());
      else if (n.includes('indeks nośności')) found = findId(product.load_index || '');
      else if (n.includes('sezon')) {
        const s = (product.season || '').toLowerCase();
        const candidates = s.includes('sum') || s.includes('let')
          ? ['Letnia', 'Lato', 'Letni']
          : s.includes('win') || s.includes('zim')
            ? ['Zimowa', 'Zima', 'Zimowy']
            : s.includes('all') || s.includes('całor')
              ? ['Całoroczna', 'Całoroczny']
              : [];
        for (const c of candidates) { found = findId(c); if (found) break; }
      } else if (n.includes('typ pojazdu') || n.includes('rodzaj pojazdu')) {
        const vc = (product.vehicle_class || '').toLowerCase();
        const candidates = vc.includes('suv') ? ['SUV', '4x4'] : ['Osobowe', 'Osobowy'];
        for (const c of candidates) { found = findId(c); if (found) break; }
      }
      if (found) result[p.id] = found;
    }
    // non-dict: skip — leave for AI fill
  }

  return result;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AllegroForm({ product, onPublished, accountPrices }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editMode = searchParams.has('edit');
  const [form, setForm] = useState<AllegroFormData>({ ...EMPTY_FORM });

  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [offerId, setOfferId] = useState<number | null>(null);
  // per-account published state: { account_id → { allegroOfferId, status } }
  const [publishedAccounts, setPublishedAccounts] = useState<Record<string, { allegroOfferId: string; status: string }>>({});

  const [loadingFill, setLoadingFill] = useState(false);
  const [loadingDescribe, setLoadingDescribe] = useState(false);
  const [loadingValidate, setLoadingValidate] = useState(false);
  const [loadingSave, setLoadingSave] = useState(false);
  const [publishingAccountId, setPublishingAccountId] = useState<string | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [loadingParams, setLoadingParams] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [statusAll, setStatusAll] = useState(false);
  const [publishingAllState, setPublishingAllState] = useState(false);

  const [categoryParams, setCategoryParams] = useState<AllegroParamDef[]>([]);
  const [publishError, setPublishError] = useState<{ summary: string; items: string[]; raw?: string } | null>(null);
  const [loadingAIFix, setLoadingAIFix] = useState(false);
  // AI lock — in edit mode AI is disabled until user explicitly confirms
  const [aiUnlocked, setAiUnlocked] = useState(false);
  const [aiPendingAction, setAiPendingAction] = useState<null | (() => void)>(null);
  const [aiFixResult, setAiFixResult] = useState<{ summary: string; changes: { field: string; was: string; fixed: string; reason: string }[] } | null>(null);
  const [payloadPreview, setPayloadPreview] = useState<object | null>(null);

  const [accounts, setAccounts] = useState<{ account_id: string; account_name: string }[]>([]);
  const [shippingRates, setShippingRates] = useState<Record<string, { id: string; name: string }[]>>({});
  const [loadingShippingRates, setLoadingShippingRates] = useState(false);

  // Auto-fill state
  const [needsAutoFill, setNeedsAutoFill] = useState(false);
  const [autoFilling, setAutoFilling] = useState(false);
  const [autoFillStep, setAutoFillStep] = useState<'fill' | 'describe' | 'save' | null>(null);
  const autoFillTriggered = useRef(false);
  const lastPublishAccountRef = useRef('default');
  const [suggestedCategories, setSuggestedCategories] = useState<{ id: string; name: string }[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [loadingTitles, setLoadingTitles] = useState(false);
  // Stores categoryId for which params finished loading — auto-fill waits for this
  const [paramsLoadedForCategory, setParamsLoadedForCategory] = useState('');

  // Track whether current params came from a saved draft (→ don't overwrite on param load)
  const draftRestoredRef = useRef(false);
  // Ref to missing-fields panel — used to scroll+flash when publish is blocked
  const missingPanelRef = useRef<HTMLDivElement>(null);
  const [publishBlockedFlash, setPublishBlockedFlash] = useState(false);

  // ── Load Allegro accounts ──────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/allegro/accounts')
      .then((r) => r.json())
      .then((d) => {
        const list = d.accounts || [];
        setAccounts(list);
      })
      .catch(() => { });
  }, []);

  // ── Load shipping rates for each account ───────────────────────────────────
  useEffect(() => {
    if (accounts.length === 0) return;
    setLoadingShippingRates(true);
    Promise.all(
      accounts.map((acc) =>
        fetch(`/api/allegro/shipping-rates?accountId=${encodeURIComponent(acc.account_id)}`)
          .then((r) => r.json())
          .then((d) => ({ accountId: acc.account_id, rates: (d.rates || []) as { id: string; name: string }[] }))
          .catch(() => ({ accountId: acc.account_id, rates: [] as { id: string; name: string }[] }))
      )
    ).then((results) => {
      const map: Record<string, { id: string; name: string }[]> = {};
      for (const r of results) map[r.accountId] = r.rates;
      setShippingRates(map);
      // Auto-match rate by quantity_in_set, fall back to first rate
      setForm((prev) => {
        const rateIds = { ...(prev.shippingRateIds || {}) };
        for (const r of results) {
          const matched = matchShippingRateByQty(r.rates, prev.quantity_in_set || 1);
          if (matched) rateIds[r.accountId] = matched;
        }
        return { ...prev, shippingRateIds: rateIds };
      });
    }).finally(() => setLoadingShippingRates(false));
  }, [accounts]);


  useEffect(() => {

    let statusAccountOffer = 0;

    accounts.forEach(acc => {
      const published = publishedAccounts[acc.account_id];
      if (published) statusAccountOffer++;
    })

    if (statusAccountOffer > 0) setStatusAll(true);
  }, [publishedAccounts]);


  console.log(product);

  // ── Init from product ──────────────────────────────────────────────────────
  const initFromProduct = () => {
    const offerQty = product.extra_json?.offer_qty ?? product.qty;
    const dotList = (product.extra_json?.dot_list as string[] | undefined) || [];
    const dotYear = dotList[0] ? '20' + dotList[0].slice(2, 4) : product.production_year || '';

    const s = (product.season || '').toLowerCase();
    const seasonLabel = s.includes('sum') || s.includes('let') ? 'letnie'
      : s.includes('win') || s.includes('zim') ? 'zimowe'
        : s.includes('all') || s.includes('całor') || s.includes('rok') ? 'całoroczne'
          : product.season || '';

    const isUsed = product.condition === 'used';
    let titleSuffix = '';
    if (!isUsed) {
      const prodYear = parseInt(dotYear || '0', 10);
      const currentYear = new Date().getFullYear();
      titleSuffix = prodYear > 0 && prodYear >= currentYear - 2 ? ' NOWE' : ' Nieużywane';
    }

    const baseTitle = `${product.brand} ${product.model} ${product.width}/${product.profile} R${product.diameter} ${product.load_index || ''}${(product.speed_index || '').toUpperCase()}${product.xl ? ' XL' : ''} ${seasonLabel}`
      .replace(/\bużywane?\b/gi, '').replace(/\s+/g, ' ').trim();
    const title = (baseTitle + titleSuffix).slice(0, 75);

    setForm((prev) => ({
      ...prev,
      sku: product.sku || '',
      brand: product.brand || '',
      condition: isUsed ? 'USED' : 'NEW',
      invoice: isUsed ? 'VAT_MARGIN' : 'VAT',
      price: product.price_gross || 0,
      quantity: 1,
      quantity_in_set: offerQty || 1,
      images: product.extra_json?.gallery_images || [],
      shippingCost: product.shipping_cost || 25,
      title,
      params: {},
    }));
    void dotYear;
  };

  // ── Load draft on mount ────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/offers?typesense_id=${encodeURIComponent(product.id)}`)
      .then((r) => r.json())
      .then((data) => {
        // Pick the Allegro-specific offer — product may have multiple offers (Allegro + Mirakl/Empik).
        // Taking [0] (most recently updated) would load Mirakl form_data which has no `params`.
        const allOffers = (data.offers || []) as { marketplace?: string; form_data?: unknown; id: number; category_id?: string }[];
        const existing = allOffers.find((o) => !o.marketplace || o.marketplace === 'allegro') ?? allOffers[0];

        // Load per-account published state for the Allegro offer specifically.
        // data.accountOffers belongs to offers[0] — may be wrong if Mirakl was updated later.
        // Use offerAccountsMap[existing.id] when available.
        const allegroAccountOffers = existing
          ? ((data.offerAccountsMap?.[existing.id] || data.accountOffers || []) as { account_id: string; allegro_offer_id: string; status: string; marketplace?: string }[])
          : [];
        if (allegroAccountOffers.length > 0) {
          const map: Record<string, { allegroOfferId: string; status: string }> = {};
          for (const ao of allegroAccountOffers) {
            if (ao.allegro_offer_id && (!ao.marketplace || ao.marketplace === 'allegro')) {
              map[ao.account_id] = { allegroOfferId: ao.allegro_offer_id, status: ao.status };
            }
          }
          setPublishedAccounts(map);
        }
        if (existing) {
          let rawData: unknown = existing.form_data;
          if (typeof rawData === 'string') {
            try { rawData = JSON.parse(rawData); } catch { rawData = null; }
          }
          if (!rawData || typeof rawData !== 'object') {
            // form_data missing or corrupted — init from product, keep category_id from DB
            initFromProduct();
            setOfferId(existing.id);
            if (existing.category_id) {
              setForm((prev) => ({ ...prev, categoryId: existing.category_id ?? '' }));
            }
            return;
          }
          // Migrate old format: if old flat fields exist but no params, convert
          const migrated = migrateOldFormData(rawData as Partial<AllegroFormData> & Record<string, unknown>);
          setForm({ ...EMPTY_FORM, ...migrated });
          setOfferId(existing.id);
          if (Object.keys(migrated.params || {}).length > 0) {
            draftRestoredRef.current = true;
          }
          // Auto-fill if draft has no description and no params
          const hasDescription = !!(migrated.description?.trim());
          const hasParams = Object.keys(migrated.params || {}).length > 0;
          if (!hasDescription && !hasParams) setNeedsAutoFill(true);
        } else {
          initFromProduct();
          setNeedsAutoFill(true);
        }
      })
      .catch(() => { initFromProduct(); setNeedsAutoFill(true); })
      .finally(() => setLoadingDraft(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  // ── Load category params when categoryId changes ──────────────────────────
  useEffect(() => {
    if (!form.categoryId) {
      setCategoryParams([]);
      return;
    }
    setLoadingParams(true);
    const catId = encodeURIComponent(form.categoryId);
    Promise.all([
      fetch(`/api/allegro/categories/${catId}/product-parameters`).then((r) => r.json()),
      fetch(`/api/allegro/categories/${catId}/parameters`).then((r) => r.json()),
    ])
      .then(([prodData, offerData]) => {
        const prodParams: AllegroParamDef[] = prodData.parameters || [];
        const offerParams: AllegroParamDef[] = offerData.parameters || [];
        // Merge: product-params first, then offer-params not already present
        const seen = new Set(prodParams.map((p) => p.id));
        const merged = [...prodParams, ...offerParams.filter((p) => !seen.has(p.id))];
        setCategoryParams(merged);
        // Pre-fill from product only on fresh category selection (not draft restore)
        if (!draftRestoredRef.current) {
          const prefilled = prefillParamsFromProduct(merged, product);
          setForm((prev) => ({ ...prev, params: { ...prefilled, ...prev.params } }));
        }
        draftRestoredRef.current = false;
      })
      .catch(() => setCategoryParams([]))
      .finally(() => {
        setLoadingParams(false);
        setParamsLoadedForCategory(form.categoryId);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.categoryId]);

  // ── AI category suggestion — runs when no category set yet ──────────────
  useEffect(() => {
    // Never run AI auto-fill on an already-published offer — data must come from Allegro API
    if (!needsAutoFill || form.categoryId || loadingDraft || isPublished) return;
    setLoadingSuggestions(true);

    fetch('/api/ai/suggest-category', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id }),
    })
      .then((r) => r.json())
      .then((d: { categoryId?: string; categoryName?: string; error?: string }) => {
        if (d.categoryId && d.categoryName) {
          // AI picked a category — auto-select it, triggering param load → auto-fill chain
          draftRestoredRef.current = false;
          setForm((prev) => ({ ...prev, categoryId: d.categoryId!, categoryName: d.categoryName!, params: {} }));
        } else {
          // AI failed — fall back to phrase-based suggestions for manual selection
          const phrase = furnitureSearchPhrase(product);
          return fetch(`/api/allegro/categories?phrase=${encodeURIComponent(phrase)}`)
            .then((r) => r.json())
            .then((cats) => setSuggestedCategories((cats.categories as { id: string; name: string }[]) || []));
        }
      })
      .catch(() => {
        // Network error — show phrase-based fallback
        const phrase = furnitureSearchPhrase(product);
        fetch(`/api/allegro/categories?phrase=${encodeURIComponent(phrase)}`)
          .then((r) => r.json())
          .then((cats) => setSuggestedCategories((cats.categories as { id: string; name: string }[]) || []))
          .catch(() => { });
      })
      .finally(() => setLoadingSuggestions(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAutoFill, form.categoryId, loadingDraft]);

  // ── Auto-fill sequence (runs after category is chosen) ───────────────────
  useEffect(() => {
    if (!needsAutoFill) return;
    if (autoFillTriggered.current) return;
    if (loadingDraft) return;
    if (isPublished) return;  // never auto-fill published offers — data comes from Allegro API
    if (!form.categoryId) return;  // wait — user must pick a category first
    if (paramsLoadedForCategory !== form.categoryId) return;  // wait for params to finish loading

    autoFillTriggered.current = true;

    const run = async () => {
      setAutoFilling(true);
      let filledForm: AllegroFormData = form;
      try {
        // Step 1: AI fill params (sends full product JSON)
        setAutoFillStep('fill');
        const fillRes = await fetch('/api/ai/fill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: product.id,
            product,
            categoryId: form.categoryId,
            categoryName: form.categoryName,
            categoryParams,
          }),
        });
        const fillData = await fillRes.json();
        if (!fillRes.ok) throw new Error(fillData.error || 'Błąd AI fill');
        filledForm = {
          ...form,
          ...fillData.formData,
          categoryId: form.categoryId,
          categoryName: form.categoryName,
          params: mergeParamsWithEanGuard(form.params, fillData.formData?.params || {}),
        };
        setForm(filledForm);

        // Step 2: AI description (sends full product JSON)
        setAutoFillStep('describe');
        const descRes = await fetch('/api/ai/describe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: product.id, product, formData: filledForm }),
        });
        const descData = await descRes.json();
        if (!descRes.ok) throw new Error(descData.error || 'Błąd AI opis');
        filledForm = { ...filledForm, description: descData.description };
        setForm(filledForm);

        handleGenerateAccountTitles();
        // Step 3: Save
        setAutoFillStep('save');
        const saveUrl = offerId ? `/api/offers/${offerId}` : '/api/offers';
        const saveMethod = offerId ? 'PUT' : 'POST';
        const saveRes = await fetch(saveUrl, {
          method: saveMethod,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            typesense_id: product.id,
            typesense_collection: 'tyres',
            form_data: filledForm,
            title: filledForm.title,
            description: filledForm.description,
            price: filledForm.price,
            quantity: filledForm.quantity,
            category_id: filledForm.categoryId,
          }),
        });
        const saveData = await saveRes.json();
        if (!saveRes.ok) throw new Error(saveData.error || 'Błąd zapisu');
        setOfferId(saveData.id);
        toast.success('Formularz wypełniony i zapisany automatycznie!');
      } catch (e) {
        toast.error('Błąd auto-wypełnienia: ' + String(e));
        autoFillTriggered.current = false;
      } finally {
        setAutoFilling(false);
        setAutoFillStep(null);
        setNeedsAutoFill(false);
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAutoFill, loadingDraft, form.categoryId, paramsLoadedForCategory]);

  // ── Param helpers ──────────────────────────────────────────────────────────
  const setField = <K extends keyof AllegroFormData>(key: K, value: AllegroFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setValidation(null);
  };

  const setParam = (id: string, value: string | string[]) => {
    setForm((prev) => ({ ...prev, params: { ...prev.params, [id]: value } }));
    setValidation(null);
  };

  const EAN_PLACEHOLDER = '0000000000000';
  const EAN_PARAM_IDS = new Set(['224017', '225693']);

  // Merge AI params but never overwrite a non-empty EAN with empty/missing value
  const mergeParamsWithEanGuard = (
    existing: Record<string, string | string[]>,
    incoming: Record<string, string | string[]>
  ): Record<string, string | string[]> => {
  const merged = { ...existing, ...incoming };
  for (const eanId of Array.from(EAN_PARAM_IDS)) {
    const existingVal = existing[eanId];
    const incomingVal = incoming[eanId];
      const existingFilled = existingVal && (Array.isArray(existingVal) ? existingVal.length > 0 : existingVal !== '' && existingVal !== EAN_PLACEHOLDER);
      const incomingEmpty = !incomingVal || (Array.isArray(incomingVal) ? incomingVal.length === 0 : incomingVal === '');
      if (existingFilled && incomingEmpty) {
        merged[eanId] = existingVal;
      }
    }
    return merged;
  };

  // ── Validation ─────────────────────────────────────────────────────────────
  const missingRequired = useMemo(() => {
    const missing: { id: string; name: string }[] = [];
    if (!form.title.trim()) missing.push({ id: '_title', name: 'Tytuł aukcji' });
    if (!form.price || form.price <= 0) missing.push({ id: '_price', name: 'Cena' });
    if (!form.categoryId) missing.push({ id: '_category', name: 'Kategoria' });
    for (const p of categoryParams) {
      if (!p.required) continue;
      const v = form.params[p.id];
      const strVal = Array.isArray(v) ? v[0] ?? '' : (v ?? '');
      const empty = !v || (Array.isArray(v) ? v.length === 0 : v === '');
      // EAN placeholder counts as missing — real EAN code required
      const isPlaceholder = EAN_PARAM_IDS.has(p.id) && strVal === EAN_PLACEHOLDER;
      if (empty || isPlaceholder) missing.push({ id: p.id, name: p.name + (isPlaceholder ? ' (wpisz prawdziwy kod EAN)' : '') });
    }
    return missing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, categoryParams]);

  // ── AI actions ─────────────────────────────────────────────────────────────
  const handleAIFill = async () => {
    setLoadingFill(true);
    try {
      const res = await fetch('/api/ai/fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          categoryId: form.categoryId,
          categoryName: form.categoryName,
          categoryParams,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd AI');
      setForm((prev) => ({
        ...prev,
        ...data.formData,
        categoryId: prev.categoryId,
        categoryName: prev.categoryName,
        params: mergeParamsWithEanGuard(prev.params, data.formData.params || {}),
      }));
      handleGenerateAccountTitles();
      toast.success('Formularz wypełniony przez AI!');
    } catch (e) {
      toast.error('Błąd AI Fill: ' + String(e));
    } finally {
      setLoadingFill(false);
    }
  };

  const handleGenerateDescription = async () => {
    setLoadingDescribe(true);
    try {
      const res = await fetch('/api/ai/describe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, formData: product }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd AI');
      setField('description', data.description);
      toast.success('Opis wygenerowany!');
    } catch (e) {
      toast.error('Błąd opisu: ' + String(e));
    } finally {
      setLoadingDescribe(false);
    }
  };

  const handleValidate = async () => {
    setLoadingValidate(true);
    setValidation(null);


    try {
      const res = await fetch('/api/ai/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, formData: form, categoryParams }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd walidacji');
      setValidation(data);
      if (data.valid) toast.success(`Walidacja OK! Wynik: ${data.score}/100`);
      else toast.error(`Znaleziono ${data.issues?.length} problemów`);
    } catch (e) {
      toast.error('Błąd walidacji: ' + String(e));
    } finally {
      setLoadingValidate(false);
    }
  };

  const handleSave = async () => {
    setLoadingSave(true);
    try {
      const url = offerId ? `/api/offers/${offerId}` : '/api/offers';
      const method = offerId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          typesense_id: product.id,
          typesense_collection: 'tyres',
          form_data: form,
          title: form.title,
          description: form.description,
          price: form.price,
          quantity: form.quantity,
          category_id: form.categoryId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd zapisu');
      setOfferId(data.id);
      toast.success('Zapisano draft!');
    } catch (e) {
      toast.error('Błąd zapisu: ' + String(e));
    } finally {
      setLoadingSave(false);
    }
  };

  const handleGenerateAccountTitles = async () => {
    if (!form.title.trim()) { toast.error('Najpierw wpisz tytuł bazowy'); return; }
    if (accounts.length === 0) { toast.error('Brak kont Allegro'); return; }
    setLoadingTitles(true);
    try {
      const res = await fetch('/api/ai/titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, baseTitle: form.title, accounts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd generowania');
      setForm((prev) => ({ ...prev, accountTitles: { ...prev.accountTitles, ...data.titles } }));
      toast.success('Tytuły wygenerowane!');
    } catch (e) {
      toast.error('Błąd: ' + String(e));
    } finally {
      setLoadingTitles(false);
    }
  };

  const handlePublishAll = async () => {
    setPublishingAllState(true);

    await Promise.all(accounts.map(acc => handlePublish(acc.account_id)))

    setPublishingAllState(false);
  }
  const handlePublish = async (accountId: string) => {
    if (!offerId) { toast.error('Najpierw zapisz draft!'); return; }
    if (missingRequired.length > 0) {
      toast.error(`Uzupełnij ${missingRequired.length} wymaganych pól przed wystawieniem`);
      setPublishBlockedFlash(true);
      setTimeout(() => setPublishBlockedFlash(false), 1200);
      missingPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setPublishingAccountId(accountId);
    lastPublishAccountRef.current = accountId;
    setPublishError(null);
    try {
      const res = await fetch(`/api/allegro/publish/${offerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formData: {
            ...form,
            price: accountPrices?.[accountId] ?? form.price,
            title: form.accountTitles?.[accountId]?.trim() || form.title,
          },
          accountId,
          basePrice: product.price_gross || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Auto-fix: CATEGORY_MISMATCH → switch to correct category and retry once
        const mismatch = parseCategoryMismatch(data.details);
        if (mismatch) {
          toast(`Kategoria zmieniona na ${mismatch.existingCategoryName} (${mismatch.existingCategoryId}) — ponawiam…`, { icon: '🔄' });
          setForm((prev) => ({ ...prev, categoryId: mismatch.existingCategoryId, categoryName: mismatch.existingCategoryName }));
          // Give React one tick to update form state, then retry with corrected category inline
          const correctedForm = { ...form, categoryId: mismatch.existingCategoryId, categoryName: mismatch.existingCategoryName };
          const retryRes = await fetch(`/api/allegro/publish/${offerId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              formData: {
                ...correctedForm,
                price: accountPrices?.[accountId] ?? correctedForm.price,
                title: correctedForm.accountTitles?.[accountId]?.trim() || correctedForm.title,
              },
              accountId,
              basePrice: product.price_gross || null,
            }),
          });
          const retryData = await retryRes.json();
          if (retryRes.ok) {
            setPublishError(null);
            if (retryData.accountOffers) {
              const map: Record<string, { allegroOfferId: string; status: string }> = {};
              for (const ao of retryData.accountOffers as { account_id: string; allegro_offer_id: string; status: string }[]) {
                if (ao.allegro_offer_id) map[ao.account_id] = { allegroOfferId: ao.allegro_offer_id, status: ao.status };
              }
              setPublishedAccounts(map);
            } else {
              setPublishedAccounts((prev) => ({ ...prev, [accountId]: { allegroOfferId: retryData.allegroOfferId, status: 'active' } }));
            }
            toast.success(`Kategoria poprawiona i oferta wystawiona! ID: ${retryData.allegroOfferId}`);
            return;
          }
          // Retry also failed — show the retry error
          const retryErrors = parseAllegroErrors(retryData.details);
          setPublishError({
            summary: `Allegro odrzuciło ofertę po korekcie kategorii (${retryRes.status})`,
            items: retryErrors.length > 0 ? retryErrors : ['Błąd publikacji'],
            raw: retryData.details,
          });
          toast.error(retryErrors[0] || 'Błąd po korekcie kategorii');
          return;
        }

        const errors = parseAllegroErrors(data.details);
        console.log(errors, data);

        setPublishError({
          summary: `Allegro odrzuciło ofertę (${res.status})`,
          items: errors.length > 0 ? errors : [JSON.stringify(errors) || 'Błąd publikacji'],
          raw: data.details,
        });
        toast.error(errors[0] || data.error || 'Błąd publikacji');
        return;
      }
      setPublishError(null);
      // Update per-account published state
      if (data.accountOffers) {
        const map: Record<string, { allegroOfferId: string; status: string }> = {};
        for (const ao of data.accountOffers as { account_id: string; allegro_offer_id: string; status: string }[]) {
          if (ao.allegro_offer_id) map[ao.account_id] = { allegroOfferId: ao.allegro_offer_id, status: ao.status };
        }
        setPublishedAccounts(map);
      } else {
        setPublishedAccounts((prev) => ({ ...prev, [accountId]: { allegroOfferId: data.allegroOfferId, status: 'active' } }));
      }
      toast.success(`Oferta wystawiona na ${accountId}! ID: ${data.allegroOfferId}`);
    } catch (e) {
      setPublishError({ summary: 'Błąd połączenia', items: [String(e)] });
      toast.error('Błąd publikacji: ' + String(e));
    } finally {
      setPublishingAccountId(null);
    }
  };

  // Whether this offer is already published on Allegro (published offers = edit mode = AI locked)
  const isPublished = Object.keys(publishedAccounts).length > 0 || editMode;

  // Wrap any AI action: if offer is published and AI not yet unlocked, intercept and ask first
  const guardAi = (action: () => void) => {
    if (!isPublished || aiUnlocked) { action(); return; }
    setAiPendingAction(() => action);
  };

  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [loadingLive, setLoadingLive] = useState(false);

  const handleLoadFromAllegro = async (accountId: string) => {
    const allegroOfferId = publishedAccounts[accountId]?.allegroOfferId;
    if (!allegroOfferId) { toast.error('Brak ID oferty Allegro'); return; }
    setLoadingLive(true);
    try {
      const res = await fetch(
        `/api/allegro/offer?allegroOfferId=${encodeURIComponent(allegroOfferId)}&accountId=${encodeURIComponent(accountId)}`
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.details || d.error || 'Błąd pobierania');
      setForm((prev) => ({
        ...prev,
        ...d.formData,
        // Keep our categoryName if Allegro doesn't return it
        categoryName: d.formData.categoryName || prev.categoryName,
        // Merge params — live Allegro data takes priority
        params: { ...prev.params, ...(d.formData.params || {}) },
      }));
      draftRestoredRef.current = true;
      toast.success(`Wczytano dane z Allegro (#${allegroOfferId})`);
    } catch (e) {
      toast.error('Błąd: ' + String(e));
    } finally {
      setLoadingLive(false);
    }
  };

  const handleEdit = async (accountId: string) => {
    if (!offerId) { toast.error('Najpierw zapisz draft!'); return; }
    setEditingAccountId(accountId);
    setPublishError(null);
    try {
      const res = await fetch(`/api/allegro/publish/${offerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formData: {
            ...form,
            price: accountPrices?.[accountId] ?? form.price,
            title: form.accountTitles?.[accountId]?.trim() || form.title,
          },
          accountId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errors = parseAllegroErrors(data.details);
        setPublishError({
          summary: `Błąd edycji oferty (${res.status})`,
          items: errors.length > 0 ? errors : ['Błąd edycji'],
          raw: data.details,
        });
        toast.error(errors[0] || data.error || 'Błąd edycji');
        return;
      }
      toast.success(`Oferta zaktualizowana! Allegro #${data.allegroOfferId}`);
    } catch (e) {
      setPublishError({ summary: 'Błąd połączenia', items: [String(e)] });
      toast.error('Błąd edycji: ' + String(e));
    } finally {
      setEditingAccountId(null);
    }
  };

  const handleAIFix = async (lastPublishingAccountId: string) => {
    if (!publishError?.raw) return;
    setLoadingAIFix(true);
    setAiFixResult(null);
    try {
      const res = await fetch('/api/ai/fix-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          formData: form,
          categoryParams,
          allegroError: publishError.raw,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd AI Fix');

      const fixed: AllegroFormData = {
        ...form,
        ...data.formData,
        categoryId: form.categoryId,
        categoryName: form.categoryName,
        params: { ...form.params, ...(data.formData?.params || {}) },
      };
      setForm(fixed);
      setPublishError(null);
      setAiFixResult({ summary: data.summary || 'AI naprawiło formularz', changes: data.changes || [] });

      // Persist fix to DB silently
      const saveRes = await fetch(offerId ? `/api/offers/${offerId}` : '/api/offers', {
        method: offerId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          typesense_id: product.id,
          typesense_collection: 'tyres',
          form_data: fixed,
          title: fixed.title,
          description: fixed.description,
          price: fixed.price,
          quantity: fixed.quantity,
          category_id: fixed.categoryId,
        }),
      });
      const saveData = await saveRes.json();
      if (saveRes.ok && saveData.id) setOfferId(saveData.id);

      // Auto-retry publish with fixed data
      await handlePublish(lastPublishingAccountId);
    } catch (e) {
      toast.error('AI Fix nie powiódł się: ' + String(e));
    } finally {
      setLoadingAIFix(false);
    }
  };

  const handlePreviewPayload = async () => {
    setLoadingPreview(true);
    try {
      const res = await fetch('/api/allegro/preview-payload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formData: form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error + (data.details ? ': ' + data.details : ''));
      setPayloadPreview(data.payload as object);
    } catch (e) {
      toast.error('Błąd podglądu: ' + String(e));
    } finally {
      setLoadingPreview(false);
    }
  };

  const galleryImages = product.extra_json?.gallery_images || [];

  if (loadingDraft) {
    return <div className="card p-8 text-center text-gray-400 animate-pulse">Ładowanie draftu...</div>;
  }

  // Sort params: required first, then optional
  const sortedParams = [...categoryParams].sort((a, b) => {
    if (a.required && !b.required) return -1;
    if (!a.required && b.required) return 1;
    return 0;
  });



  const overlayBusy = autoFilling || loadingParams || loadingSuggestions || loadingFill || loadingDescribe;
  const overlayLabel = loadingSuggestions ? 'AI dopasowuje kategorię…'
    : autoFilling ? (autoFillStep === 'describe' ? 'AI generuje opis…' : autoFillStep === 'save' ? 'Zapisywanie…' : 'AI wypełnia formularz…')
    : loadingParams ? 'Ładowanie parametrów kategorii…'
    : loadingFill ? 'AI wypełnia formularz…'
    : 'AI generuje opis…';

  return (
    <div className="space-y-5 relative">
      <CrudOverlay show={overlayBusy} label={overlayLabel} accent="allegro" />

      {/* Top info bar */}
      <div className="card p-4 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{product.brand} {product.model}</p>
          <p className="text-xs text-gray-500">{product.size_raw} · {product.condition} · {product.extra_json?.offer_qty ?? product.qty} szt.</p>
        </div>
        {Object.values(publishedAccounts).map(({ allegroOfferId }) => (
          <span key={allegroOfferId} className="badge-active shrink-0">Allegro #{allegroOfferId}</span>
        ))}
      </div>

      {/* Category suggestion banner — shown when no category selected yet */}
      {needsAutoFill && !autoFilling && !form.categoryId && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
          <p className="text-sm font-medium text-blue-800">
            {loadingSuggestions
              ? '🤖 AI rozpoznaje kategorię produktu...'
              : 'AI nie mogło rozpoznać kategorii — wybierz ręcznie:'}
          </p>
          {loadingSuggestions ? (
            <p className="text-xs text-blue-500">Analizuję produkt i dopasowuję kategorię Allegro...</p>
          ) : suggestedCategories.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {suggestedCategories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => { setField('categoryId', cat.id); setField('categoryName', cat.name); }}
                  className="text-xs px-3 py-1.5 rounded-full border border-blue-300 bg-white text-blue-700 hover:bg-blue-100 hover:border-blue-400 transition-colors"
                >
                  {cat.name}
                </button>
              ))}
            </div>
          ) : null}
          <p className="text-xs text-blue-500">Możesz też wybrać z drzewa kategorii poniżej</p>
        </div>
      )}

      {/* Auto-fill in-progress banner */}
      {autoFilling && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-indigo-500 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-indigo-700">
              {autoFillStep === 'fill' && 'AI wypełnia pola formularza...'}
              {autoFillStep === 'describe' && 'AI generuje opis oferty...'}
              {autoFillStep === 'save' && 'Zapisywanie draftu...'}
            </p>
            <div className="mt-1.5 flex gap-1.5">
              {(['fill', 'describe', 'save'] as const).map((step, i, arr) => {
                const stepIdx = arr.indexOf(autoFillStep!);
                return (
                  <div
                    key={step}
                    className={clsx(
                      'h-1.5 rounded-full flex-1 transition-colors',
                      i === stepIdx ? 'bg-indigo-500' : i < stepIdx ? 'bg-indigo-300' : 'bg-indigo-100'
                    )}
                  />
                );
              })}
            </div>
          </div>
          <p className="text-xs text-indigo-500">Zapis nastąpi automatycznie</p>
        </div>
      )}

      {/* AI confirmation banner — shown when user clicks AI on a published offer */}
      {aiPendingAction && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 flex items-start gap-3">
          <span className="text-amber-500 text-xl shrink-0">⚠</span>
          <div className="flex-1 space-y-2">
            <p className="text-sm font-semibold text-amber-800">
              Ta oferta jest już wystawiona na Allegro — AI może nadpisać rzeczywiste dane
            </p>
            <p className="text-xs text-amber-700">
              Formularz powinien zawierać twarde dane z Allegro (pobrane przyciskiem ↓). Użycie AI może wygenerować błędne lub niezgodne wartości parametrów.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { setAiUnlocked(true); aiPendingAction(); setAiPendingAction(null); }}
                className="btn-sm px-3 py-1.5 bg-amber-600 text-white rounded-md text-xs font-semibold hover:bg-amber-700"
              >
                Rozumiem — uruchom AI
              </button>
              <button
                onClick={() => setAiPendingAction(null)}
                className="btn-sm px-3 py-1.5 bg-white border border-amber-300 text-amber-700 rounded-md text-xs font-semibold hover:bg-amber-50"
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI action bar */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-700 mr-1">AI:</span>
          {/* In edit mode — fetch live data from Allegro first (primary action) */}
          {Object.keys(publishedAccounts).length > 0 && (
            <div className="flex gap-1.5">
              {Object.entries(publishedAccounts).map(([accId, pub]) => (
                <button
                  key={accId}
                  onClick={() => handleLoadFromAllegro(accId)}
                  disabled={loadingLive}
                  title={`Pobierz aktualne dane oferty #${pub.allegroOfferId} z Allegro`}
                  className="btn-sm px-3 py-1.5 rounded-md font-semibold text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                >
                  {loadingLive ? <><Spinner /> Pobieranie...</> : `↓ Pobierz z Allegro #${pub.allegroOfferId}`}
                </button>
              ))}
              <span className="text-xs text-gray-400 self-center">|</span>
            </div>
          )}
          <button
            onClick={() => guardAi(handleAIFill)}
            disabled={loadingFill}
            className={clsx('btn-secondary btn-sm', isPublished && !aiUnlocked && 'opacity-50')}
            title={isPublished && !aiUnlocked ? 'AI zablokowane na wystawionej ofercie — kliknij aby potwierdzić' : undefined}
          >
            {loadingFill ? <><Spinner /> Wypełnianie...</> : isPublished && !aiUnlocked ? '🔒 Wypełnij AI' : '✨ Wypełnij'}
          </button>
          <button
            onClick={() => guardAi(handleGenerateDescription)}
            disabled={loadingDescribe}
            className={clsx('btn-secondary btn-sm', isPublished && !aiUnlocked && 'opacity-50')}
            title={isPublished && !aiUnlocked ? 'AI zablokowane na wystawionej ofercie — kliknij aby potwierdzić' : undefined}
          >
            {loadingDescribe ? <><Spinner /> Generowanie...</> : isPublished && !aiUnlocked ? '🔒 Opis AI' : '📝 Opis'}
          </button>
          <button
            onClick={() => guardAi(handleValidate)}
            disabled={loadingValidate}
            className="btn-secondary btn-sm"
          >
            {loadingValidate ? <><Spinner /> Walidacja...</> : '🔍 Waliduj'}
          </button>
          <div className="ml-auto flex gap-2">
            <button onClick={handlePreviewPayload} disabled={loadingPreview} className="btn-secondary btn-sm font-mono" title="Podgląd payload">
              {loadingPreview ? <><Spinner /> Budowanie...</> : '{ } Payload'}
            </button>
            <button onClick={handleSave} disabled={loadingSave} className="btn-secondary">
              {loadingSave ? <><Spinner /> Zapisywanie...</> : '💾 Zapisz draft'}
            </button>
            {accounts.map((acc) => {
              const published = publishedAccounts[acc.account_id];
              // editMode (from ?edit=1) acts as early hint before publishedAccounts loads from API
              if (published || (editMode && loadingDraft)) {
                return (
                  <button
                    key={acc.account_id}
                    onClick={() => handleEdit(acc.account_id)}
                    disabled={editingAccountId !== null || !offerId || loadingDraft}
                    title={published ? `Zaktualizuj ofertę Allegro #${published.allegroOfferId}` : 'Ładowanie…'}
                    className="btn bg-amber-500 text-white hover:bg-amber-600 border-amber-600 disabled:opacity-50"
                  >
                    {editingAccountId === acc.account_id
                      ? <><Spinner /> Aktualizowanie...</>
                      : loadingDraft ? <><Spinner /> Ładowanie...</>
                      : `✏ Aktualizuj ${acc.account_name}`}
                  </button>
                );
              }
              return (
                <button
                  key={acc.account_id}
                  onClick={() => handlePublish(acc.account_id)}
                  disabled={publishingAccountId !== null || !offerId}
                  title={missingRequired.length > 0 ? `Brakuje: ${missingRequired.map((f) => f.name).join(', ')}` : undefined}
                  className={clsx(
                    'btn',
                    publishingAccountId === acc.account_id ? 'btn-success' :
                      missingRequired.length === 0 ? 'btn-success' : 'opacity-60 cursor-not-allowed bg-gray-300 text-gray-600 hover:bg-gray-300'
                  )}
                >
                  {publishingAccountId === acc.account_id ? <><Spinner /> Wysyłanie...</> : `🚀 ${acc.account_name}`}
                </button>
              );
            })}

            {!editMode && (
              <button
                onClick={() => handlePublishAll()}
                disabled={statusAll}
                title="Dodaj do wszystkich kont"
                className={clsx(
                  'btn',
                  !statusAll ? 'bg-sky-600 text-white hover:bg-sky-700 border-sky-700' :
                    'opacity-60 cursor-not-allowed bg-gray-300 text-gray-600 hover:bg-gray-300'
                )}
              >
                {publishingAllState ? <><Spinner /> Wysyłanie...</> :
                  statusAll ? `✓ all` : `🚀 all`}
              </button>
            )}

            {accounts.length === 0 && (
              <button disabled className="btn btn-success opacity-50">Brak kont Allegro</button>
            )}
          </div>
        </div>
      </div>

      {/* Publish error */}
      {
        publishError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-red-700">{publishError.summary}</p>
              <button type="button" className="text-red-400 hover:text-red-600 text-lg leading-none" onClick={() => setPublishError(null)}>×</button>
            </div>
            <ul className="space-y-1">
              {publishError.items.map((item, i) => (
                <li key={i} className="text-sm text-red-600 flex gap-2"><span>•</span><span>{item}</span></li>
              ))}
            </ul>
            {publishError.raw && (
              <div className="pt-1">
                <button
                  onClick={() => handleAIFix(lastPublishAccountRef.current)}
                  disabled={loadingAIFix}
                  className="btn-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {loadingAIFix ? <><Spinner /> AI naprawia...</> : '✨ Napraw AI i ponów'}
                </button>
              </div>
            )}
          </div>
        )
      }

      {/* AI Fix result panel */}
      {
        aiFixResult && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-green-600 text-base">✅</span>
                <p className="text-sm font-semibold text-green-800">AI naprawiło formularz</p>
              </div>
              <button type="button" className="text-green-400 hover:text-green-700 text-lg leading-none" onClick={() => setAiFixResult(null)}>×</button>
            </div>
            <p className="text-sm text-green-700">{aiFixResult.summary}</p>
            {aiFixResult.changes.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Wprowadzone zmiany:</p>
                <div className="space-y-1.5">
                  {aiFixResult.changes.map((c, i) => (
                    <div key={i} className="bg-white rounded-lg border border-green-100 px-3 py-2 text-xs space-y-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-semibold text-gray-600">{c.field}</span>
                        <span className="text-red-500 line-through truncate max-w-[140px]" title={c.was}>{c.was || '(puste)'}</span>
                        <span className="text-gray-400">→</span>
                        <span className="text-green-700 font-medium truncate max-w-[140px]" title={c.fixed}>{c.fixed}</span>
                      </div>
                      <p className="text-gray-500 italic">{c.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      }

      {/* Validation panel */}
      {validation && <ValidationPanel result={validation} />}

      {/* Required fields missing */}
      {
        missingRequired.length > 0 && (
          <div
            ref={missingPanelRef}
            className={clsx(
              'rounded-xl border p-4 transition-all duration-300',
              publishBlockedFlash
                ? 'border-red-400 bg-red-100 scale-[1.01] shadow-md'
                : 'border-orange-200 bg-orange-50'
            )}
          >
            <p className={clsx('text-sm font-semibold mb-2', publishBlockedFlash ? 'text-red-700' : 'text-orange-700')}>
              ⚠ Brakuje {missingRequired.length} wymaganych pól — uzupełnij przed wystawieniem:
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {missingRequired.map((f) => (
                <li key={f.id} className={clsx(
                  'text-xs border rounded px-2 py-0.5 font-medium',
                  publishBlockedFlash ? 'bg-red-100 text-red-800 border-red-300' : 'bg-orange-100 text-orange-800 border-orange-200'
                )}>
                  {f.name}
                </li>
              ))}
            </ul>
          </div>
        )
      }

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* ── Left column ── */}
        <div className="space-y-5">

          {/* Kategoria */}
          <div className="card p-5 space-y-3">
            <h3 className="font-semibold text-gray-900 text-sm uppercase tracking-wide">Kategoria Allegro *</h3>
            <CategoryAccordion
              value={form.categoryId}
              onChange={(id, name) => {
                draftRestoredRef.current = false;
                setForm((prev) => ({ ...prev, categoryId: id, categoryName: name, params: {} }));
              }}
            />
          </div>

          {/* Podstawowe */}
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold text-gray-900 text-sm uppercase tracking-wide">Podstawowe</h3>

            <div>
              <label className="label">Tytuł aukcji <span className="text-red-500">*</span></label>
              <input
                className="input"
                value={form.title}
                onChange={(e) => setField('title', e.target.value)}
                maxLength={75}
                placeholder="Tytuł maks. 75 znaków"
              />
              <p className="text-xs text-gray-400 mt-0.5 text-right">{form.title.length}/75</p>
            </div>
       <div>
              <label className="label">Ean</label>
              <input
                className="input"
                value={product.ean}
                onChange={(e) => setField('title', e.target.value)}
                maxLength={75}
                placeholder="Tytuł maks. 75 znaków"
              />
            </div>

            {/* Per-account title variants */}
            {accounts.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="label mb-0">Tytuły per konto</label>
                  <button
                    type="button"
                    onClick={handleGenerateAccountTitles}
                    disabled={loadingTitles || !form.title.trim()}
                    className="btn-secondary btn-sm text-xs flex items-center gap-1"
                  >
                    {loadingTitles ? (
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                    ) : '✨'}
                    {loadingTitles ? 'Generuję…' : 'Generuj tytuł AI'}
                  </button>
                </div>
                
                <p className="text-xs text-gray-400">           {product.name}</p>

     
                <div className="space-y-2">
                  {accounts.map((acc) => {
                    const val = form.accountTitles?.[acc.account_id] ?? '';
                    return (
                      <div key={acc.account_id}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs font-medium text-gray-600">{acc.account_name}</span>
                          <span className="text-xs text-gray-400">{val.length}/75</span>
                        </div>
                        <input
                          className="input text-sm"
                          value={val}
                          onChange={(e) => setForm((prev) => ({
                            ...prev,
                            accountTitles: { ...prev.accountTitles, [acc.account_id]: e.target.value.slice(0, 75) },
                          }))}
                          maxLength={75}
                          placeholder={`Tytuł dla ${acc.account_name} (domyślnie jak wyżej)`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label className="label">SKU <span className="text-red-500">*</span></label>
              <input
                className="input"
                value={form.sku}
                onChange={(e) => setField('sku', e.target.value)}
                maxLength={75}
                placeholder="Wewnętrzny identyfikator produktu"
              />
              <p className="text-xs text-gray-400 mt-0.5 text-right">{form.title.length}/75</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Cena (zł) <span className="text-red-500">*</span></label>
                <input
                  type="number" className="input" value={form.price}
                  onChange={(e) => setField('price', parseFloat(e.target.value) || 0)}
                  step="0.01" min="0"
                />
              </div>
              <div>
                <label className="label">Ilość ofert</label>
                <input
                  type="number" className="input" value={form.quantity}
                  onChange={(e) => setField('quantity', parseInt(e.target.value) || 1)}
                  min="1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Sztuk w komplecie</label>
                <input
                  type="number" className="input" value={form.quantity_in_set}
                  onChange={(e) => {
                    const qty = parseInt(e.target.value) || 1;
                    setForm((prev) => {
                      const rateIds = { ...(prev.shippingRateIds || {}) };
                      for (const [accId, rates] of Object.entries(shippingRates)) {
                        const matched = matchShippingRateByQty(rates, qty);
                        if (matched) rateIds[accId] = matched;
                      }
                      return { ...prev, quantity_in_set: qty, shippingRateIds: rateIds };
                    });
                    setValidation(null);
                  }}
                  min="1"
                />
              </div>
              <div>
                <label className="label">Stan</label>
                <select
                  className="input"
                  value={form.condition}
                  onChange={(e) => {
                    const cond = e.target.value as 'NEW' | 'USED';
                    setForm((prev) => ({
                      ...prev,
                      condition: cond,
                      invoice: cond === 'USED' ? 'VAT_MARGIN' : 'VAT',
                    }));
                    setValidation(null);
                  }}
                >
                  <option value="USED">Używany</option>
                  <option value="NEW">Nowy</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label flex items-center gap-1.5">
                Rodzaj faktury
                <span className="text-xs text-gray-400 font-normal">(auto z stanu, można zmienić)</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, invoice: 'VAT' }))}
                  className={clsx(
                    'flex flex-col items-center gap-0.5 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all',
                    form.invoice === 'VAT'
                      ? 'border-allegro bg-allegro/5 text-allegro'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300 bg-white'
                  )}
                >
                  <span>Faktura VAT</span>
                  <span className="text-xs font-normal opacity-70">Produkt nowy</span>
                </button>
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, invoice: 'VAT_MARGIN' }))}
                  className={clsx(
                    'flex flex-col items-center gap-0.5 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all',
                    form.invoice === 'VAT_MARGIN'
                      ? 'border-orange-500 bg-orange-50 text-orange-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300 bg-white'
                  )}
                >
                  <span>Faktura VAT Marża</span>
                  <span className="text-xs font-normal opacity-70">Produkt używany</span>
                </button>
              </div>
            </div>

            <div>
              <label className="label">Czas wysyłki (czas przygotowania)</label>
              <select className="input" value={form.shippingTime} onChange={(e) => setField('shippingTime', e.target.value)}>
                <option value="PT24H">24h</option>
                <option value="PT48H">48h</option>
                <option value="PT72H">72h</option>
                <option value="P7D">7 dni</option>
              </select>
            </div>

            {/* Shipping rate per account */}
            {accounts.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="label mb-0">Metoda dostawy (cennik)</label>
                  {loadingShippingRates && (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <Spinner />Pobieranie...
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {accounts.map((acc) => {
                    const rates = shippingRates[acc.account_id] || [];
                    const selectedRateId = form.shippingRateIds?.[acc.account_id] ?? '';
                    return (
                      <div key={acc.account_id}>
                        <span className="text-xs font-medium text-gray-600 block mb-0.5">{acc.account_name}</span>
                        {rates.length === 0 ? (
                          <p className="text-xs text-gray-400 italic">
                            {loadingShippingRates ? 'Ładowanie...' : 'Brak cenników dostawy'}
                          </p>
                        ) : (
                          <select
                            className="input text-sm"
                            value={selectedRateId}
                            onChange={(e) => setForm((prev) => ({
                              ...prev,
                              shippingRateIds: { ...(prev.shippingRateIds || {}), [acc.account_id]: e.target.value },
                            }))}
                          >
                            <option value="">— wybierz cennik —</option>
                            {rates.map((r) => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-400">Cennik dostawy z panelu Allegro dla każdego konta.</p>
              </div>
            )}
          </div>

          {/* Parametry kategorii */}
          {form.categoryId && (
            <div className="card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 text-sm uppercase tracking-wide">
                  Parametry kategorii
                </h3>
                {loadingParams
                  ? <span className="text-xs text-gray-400">Ładowanie...</span>
                  : <span className="text-xs text-gray-400">
                    {categoryParams.filter(p => p.required).length} wymaganych · {categoryParams.length} łącznie
                  </span>
                }
              </div>

              {!loadingParams && categoryParams.length === 0 && (
                <p className="text-sm text-gray-400">Brak parametrów dla tej kategorii.</p>
              )}

              {sortedParams.map((param) => {
                const value = form.params[param.id] ?? (param.restrictions?.multipleChoices ? [] : '');
                const isEmpty = !value || (Array.isArray(value) ? value.length === 0 : value === '');
                const isInvalid = param.required && isEmpty;
                return (
                  <div key={param.id} className={clsx('rounded-lg p-2 -mx-2', isInvalid ? 'bg-red-50 ring-1 ring-red-200' : !isEmpty && 'bg-emerald-50 ring-1 ring-emerald-200')}>
                    <label className="label flex items-center gap-1">
                      <span>{param.name}</span>
                      {param.required ? (
                        <span className={clsx('text-xs font-bold', isEmpty ? 'text-red-500' : 'text-green-600')}>
                          {isEmpty ? '* wymagane' : '✓'}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">(opcjonalne)</span>
                      )}
                    </label>

                    <ParamField
                      param={param}
                      value={value}
                      onChange={(v) => setParam(param.id, v)}
                      proposal={String(form.params[`${param.id}__proposal`] ?? '')}
                      onProposalChange={(v) => setParam(`${param.id}__proposal`, v)}
                    />
                    {EAN_PARAM_IDS.has(param.id) && (Array.isArray(value) ? value[0] : value) === EAN_PLACEHOLDER && (
                      <p className="text-xs text-amber-600 mt-0.5">⚠ To jest kod zastępczy — wpisz prawdziwy kod EAN/GTIN produktu</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Right column ── */}
        <div className="space-y-5">
          <DescriptionEditor
            value={form.description}
            onChange={(v) => setField('description', v)}
          />
          <ImageGalleryPicker
            allImages={galleryImages}
            selected={form.images}
            onChange={(imgs) => setField('images', imgs)}
          />
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="card p-4 flex items-center justify-between gap-3 flex-wrap">
        <button onClick={() => router.push('/products')} className="btn-ghost">← Wróć do produktów</button>
        <div className="flex items-center gap-3 flex-wrap">
          {offerId && (
            <button onClick={() => router.push('/offers')} className="btn-secondary">Zobacz oferty →</button>
          )}
          <button onClick={handleSave} disabled={loadingSave} className="btn-secondary">
            {loadingSave ? 'Zapisywanie...' : '💾 Zapisz draft'}
          </button>
          {accounts.map((acc) => {
            const published = publishedAccounts[acc.account_id];
            if (published || (editMode && loadingDraft)) {
              return (
                <button
                  key={acc.account_id}
                  onClick={() => handleEdit(acc.account_id)}
                  disabled={editingAccountId !== null || !offerId || loadingDraft}
                  title={published ? `Allegro #${published.allegroOfferId}` : 'Ładowanie…'}
                  className="btn bg-amber-500 text-white hover:bg-amber-600 border-amber-600 disabled:opacity-50"
                >
                  {editingAccountId === acc.account_id ? 'Aktualizowanie...'
                    : loadingDraft ? 'Ładowanie...'
                    : `✏ Aktualizuj ${acc.account_name}`}
                </button>
              );
            }
            return (
              <button
                key={acc.account_id}
                onClick={() => handlePublish(acc.account_id)}
                disabled={publishingAccountId !== null || !offerId}
                className={clsx('btn', missingRequired.length === 0 ? 'btn-success' : 'bg-allegro text-white hover:bg-allegro-dark')}
              >
                {publishingAccountId === acc.account_id ? 'Wysyłanie...' : `🚀 ${acc.account_name}`}
              </button>
            );
          })}
        </div>
      </div>

      {/* Payload preview modal */}
      {
        payloadPreview && (
          <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto" onClick={() => setPayloadPreview(null)}>
            <div className="bg-gray-950 rounded-2xl shadow-2xl w-full max-w-4xl mt-8 mb-8 overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
                <span className="text-sm font-semibold text-gray-200 font-mono">Payload → POST /sale/product-offers</span>
                <div className="flex gap-2">
                  <button className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 rounded border border-gray-700"
                    onClick={() => { navigator.clipboard.writeText(JSON.stringify(payloadPreview, null, 2)); toast.success('Skopiowano'); }}>
                    Kopiuj
                  </button>
                  <button className="text-gray-400 hover:text-gray-200 text-lg leading-none px-2" onClick={() => setPayloadPreview(null)}>×</button>
                </div>
              </div>
              <pre className="overflow-auto p-5 text-xs leading-relaxed max-h-[75vh]">
                <JsonHighlight value={payloadPreview} />
              </pre>
            </div>
          </div>
        )
      }
    </div >
  );
}

// ── Migration for old form format ─────────────────────────────────────────────
function migrateOldFormData(data: Partial<AllegroFormData> & Record<string, unknown>): AllegroFormData {
  // If already new format (has params key), return as-is
  if ('params' in data && typeof data.params === 'object' && data.params !== null) {
    return { ...EMPTY_FORM, ...data } as AllegroFormData;
  }
  // Old format had flat tyre fields — just keep structural fields, start params fresh
  return {
    ...EMPTY_FORM,
    sku: (data.sku as string) || '',
    title: (data.title as string) || '',
    categoryId: (data.categoryId as string) || '',
    categoryName: (data.categoryName as string) || '',
    description: (data.description as string) || '',
    price: (data.price as number) || 0,
    quantity: (data.quantity as number) || 1,
    quantity_in_set: (data.quantity_in_set as number) || 1,
    condition: (data.condition as 'NEW' | 'USED') || 'USED',
    invoice: (data.invoice as 'VAT' | 'VAT_MARGIN') || ((data.condition === 'NEW' ? 'VAT' : 'VAT_MARGIN')),
    shippingRateIds: (data.shippingRateIds as Record<string, string>) || {},
    images: (data.images as string[]) || [],
    shippingCost: (data.shippingCost as number) || 25,
    shippingTime: (data.shippingTime as string) || 'PT24H',
    params: {},
  };
}

/** Picks the shipping rate whose name contains "N op" (e.g. "1 opona", "2 opony"). Falls back to first rate. */
function matchShippingRateByQty(rates: { id: string; name: string }[], qty: number): string | null {
  if (rates.length === 0) return null;
  const pattern = new RegExp(`\\b${qty}\\s*op`, 'i');
  const match = rates.find((r) => pattern.test(r.name));
  return match?.id ?? rates[0].id;
}

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin inline mr-1" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}
