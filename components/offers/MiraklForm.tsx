'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import type { MebleProduct, MiraklFormData } from '@/types';

interface Operator { id: string; name: string; }
interface MiraklAccount { account_id: string; account_name: string; operator: string | null; }
interface Category { code: string; label: string; leaf: boolean; }
interface Attribute {
  code: string; label: string; type: string; required: boolean;
  multiple?: boolean; values?: { code: string; label: string }[];
}

/** Loading placeholder shown on inputs while AI is filling the form. */
function Skel({ h = 'h-9' }: { h?: string }) {
  return <div className={`w-full ${h} rounded-md bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%] animate-pulse`} />;
}

export default function MiraklForm({ product }: { product: MebleProduct }) {
  const [accounts, setAccounts] = useState<MiraklAccount[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [accountId, setAccountId] = useState('');

  const [form, setForm] = useState<MiraklFormData>(() => ({
    title: product.name,
    sku: product.sku || String(product.id),
    ean: product.ean || '',
    categoryCode: '',
    categoryLabel: '',
    description: product.description || '',
    price: product.price_gross || 0,
    quantity: product.qty || 1,
    condition: 'NEW',
    images: product.gallery_images?.length ? product.gallery_images : (product.img ? [product.img] : []),
    attributes: {},
  }));

  const [phrase, setPhrase] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [loadingAttrs, setLoadingAttrs] = useState(false);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState<null | 'category' | 'fill'>(null);
  const [status, setStatus] = useState<string | null>(null);
  const autoSuggestedRef = useRef(false);
  const lastSavedCatRef = useRef('');

  // Operator comes from the selected account; if no account is configured yet, the selected
  // value is the operator id itself and API credentials fall back to env (.env.local).
  const operator = useMemo(() => {
    const acc = accounts.find((a) => a.account_id === accountId);
    if (acc?.operator) return acc.operator;
    if (operators.some((o) => o.id === accountId)) return accountId;
    return '';
  }, [accounts, operators, accountId]);

  const hasAccounts = accounts.length > 0;

  useEffect(() => {
    fetch('/api/mirakl/accounts')
      .then((r) => r.json())
      .then((d) => {
        const accs: MiraklAccount[] = d.accounts || [];
        const ops: Operator[] = d.operators || [];
        setAccounts(accs);
        setOperators(ops);
        if (accs[0]) setAccountId(accs[0].account_id);
        else if (ops[0]) setAccountId(ops[0].id); // operate via env credentials
      })
      .catch(() => {});
  }, []);

  const set = (patch: Partial<MiraklFormData>) => setForm((f) => ({ ...f, ...patch }));

  // Producer / brand is always our own brand for furniture.
  const BRAND = 'MEBEL-PARTNER';
  const isBrandAttr = (a: Attribute) => /producent|marka|brand/i.test(a.code) || /producent|marka/i.test(a.label);
  const brandValueFor = (a: Attribute): string => {
    if (a.values && a.values.length) {
      const m = a.values.find((v) =>
        /mebel[-\s]?partner/i.test(v.label) || /mebel[-\s]?partner/i.test(v.code));
      return m?.code ?? BRAND; // value-list code if present, else raw (may be beyond the 500 cap)
    }
    return BRAND;
  };
  /** Build {code: BRAND} overrides for producer/brand attributes in the given attribute set. */
  const brandDefaults = (attrs: Attribute[]): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const a of attrs) if (isBrandAttr(a)) out[a.code] = brandValueFor(a);
    return out;
  };

  // Gallery → MEDIA image slots (main cover + "Dodatkowe zdjęcia n"). Certificates/GPSR excluded.
  const gallery = product.gallery_images?.length ? product.gallery_images : (product.img ? [product.img] : []);
  const isCertMedia = (a: Attribute) => /aghl|certyfikat|gpsr|instrukcj/i.test(`${a.code} ${a.label}`);
  const additionalIndex = (a: Attribute): number | null => {
    const m = `${a.code} ${a.label}`.match(/(?:dodatkow\w*\D*)(\d+)/i);
    return m ? parseInt(m[1]) : null;
  };
  const imageDefaults = (attrs: Attribute[]): Record<string, string> => {
    if (gallery.length === 0) return {};
    const out: Record<string, string> = {};
    const media = attrs.filter((a) => a.type === 'MEDIA' && !isCertMedia(a));
    const additional = media.filter((a) => additionalIndex(a) != null)
      .sort((x, y) => (additionalIndex(x)! - additionalIndex(y)!));
    const main = media.find((a) => additionalIndex(a) == null);
    if (main && gallery[0]) out[main.code] = gallery[0];
    additional.forEach((a, i) => { const img = gallery[i + 1]; if (img) out[a.code] = img; });
    return out;
  };

  const searchCategories = async () => {
    if (!operator || !phrase.trim()) return;
    const res = await fetch(`/api/mirakl/categories?operator=${operator}&accountId=${accountId}&phrase=${encodeURIComponent(phrase)}`);
    const d = await res.json();
    setCategories(d.categories || []);
  };

  const loadAttributes = async (code: string) => {
    setLoadingAttrs(true);
    try {
      const res = await fetch(`/api/mirakl/categories/${encodeURIComponent(code)}/attributes?operator=${operator}&accountId=${accountId}`);
      const d = await res.json();
      const attrs: Attribute[] = d.attributes || [];
      setAttributes(attrs);
      // Prefill producer/brand = MEBEL-PARTNER and gallery → MEDIA slots (without clobbering user values).
      const defaults = { ...brandDefaults(attrs), ...imageDefaults(attrs) };
      setForm((f) => ({ ...f, attributes: { ...defaults, ...f.attributes } }));
    } finally {
      setLoadingAttrs(false);
    }
  };

  const selectCategory = async (c: Category) => {
    set({ categoryCode: c.code, categoryLabel: c.label });
    setCategories([]);
    setPhrase(c.label);
    await loadAttributes(c.code);
  };

  // Step 1: try to auto-match the Empik category (heuristic search + AI fallback).
  const runSuggestCategory = async () => {
    if (!operator) return;
    setAiBusy('category');
    try {
      const res = await fetch('/api/mirakl/suggest-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: String(product.id), operator, accountId }),
      });
      const d = await res.json();
      if (d.categoryCode) {
        set({ categoryCode: d.categoryCode, categoryLabel: d.categoryLabel || d.categoryCode });
        setPhrase(d.categoryLabel || d.categoryCode);
        setCategories([]);
        await loadAttributes(d.categoryCode);
        toast.success(`AI dopasowało kategorię: ${d.categoryLabel || d.categoryCode}`);
      } else {
        toast('AI nie znalazło kategorii — wyszukaj ręcznie', { icon: 'ℹ️' });
      }
    } catch {
      toast.error('Błąd dopasowania kategorii');
    } finally {
      setAiBusy(null);
    }
  };

  // Step 2: ask AI to fill title, description and category attributes from product data.
  const runAiFill = async () => {
    if (!form.categoryCode) { toast.error('Najpierw ustaw kategorię'); return; }
    setAiBusy('fill');
    try {
      const res = await fetch('/api/mirakl/fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: String(product.id), operator, accountId,
          categoryCode: form.categoryCode, categoryLabel: form.categoryLabel,
        }),
      });
      const d = await res.json();
      if (d.error) { toast.error('Błąd AI: ' + (d.details || d.error)); return; }
      setForm((f) => ({
        ...f,
        title: d.title || f.title,
        description: d.description || f.description,
        // AI values first, then force producer/brand and gallery images (authoritative).
        attributes: { ...f.attributes, ...(d.attributes || {}), ...brandDefaults(attributes), ...imageDefaults(attributes) },
      }));
      toast.success('AI wypełniło formularz');
    } catch {
      toast.error('Błąd wypełniania AI');
    } finally {
      setAiBusy(null);
    }
  };

  // Auto-run category matching once an operator is resolved and no category is set yet.
  useEffect(() => {
    if (operator && !form.categoryCode && !autoSuggestedRef.current) {
      autoSuggestedRef.current = true;
      runSuggestCategory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operator]);

  // Persist the draft (with category) as soon as a category is assigned.
  useEffect(() => {
    if (form.categoryCode && form.categoryCode !== lastSavedCatRef.current) {
      lastSavedCatRef.current = form.categoryCode;
      saveDraft().then((id) => { if (id) toast.success('Zapisano szkic z kategorią', { id: 'mirakl-draft' }); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.categoryCode]);

  const setAttr = (code: string, value: string | string[]) =>
    setForm((f) => ({ ...f, attributes: { ...f.attributes, [code]: value } }));

  const saveDraft = async (): Promise<number | null> => {
    const res = await fetch('/api/offers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typesense_id: String(product.id),
        typesense_collection: process.env.NEXT_PUBLIC_TYPESENSE_COLLECTION || 'meble',
        marketplace: 'mirakl',
        form_data: form,
        title: form.title,
        description: form.description,
        price: form.price,
        quantity: form.quantity,
        category_id: form.categoryCode,
      }),
    });
    const d = await res.json();
    if (d?.id) { setDraftId(d.id); return d.id; }
    return null;
  };

  const handleSaveDraft = async () => {
    setBusy(true);
    try {
      const id = await saveDraft();
      if (id) toast.success('Zapisano szkic'); else toast.error('Błąd zapisu szkicu');
    } finally { setBusy(false); }
  };

  const handlePublish = async () => {
    if (!accountId) { toast.error('Wybierz konto Mirakl'); return; }
    if (!form.categoryCode) { toast.error('Wybierz kategorię Empik'); return; }
    setBusy(true);
    setStatus(null);
    try {
      const id = draftId ?? (await saveDraft());
      if (!id) { toast.error('Nie udało się zapisać szkicu'); return; }
      const res = await fetch(`/api/marketplace/publish/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, formData: form, basePrice: product.price_gross }),
      });
      const d = await res.json();
      if (res.ok && d.success) {
        toast.success('Wysłano do Empik (import w toku)');
        setStatus('pending — import produktu i oferty zgłoszony, użyj „Sprawdź status”.');
      } else {
        toast.error('Błąd publikacji');
        setStatus(`error: ${d.details || d.error || 'nieznany'}`);
      }
    } finally { setBusy(false); }
  };

  const handleSync = async () => {
    if (!draftId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/marketplace/offer-accounts?offer_id=${draftId}&sync=1`);
      const d = await res.json();
      const row = (d.accounts || []).find((a: { account_id: string }) => a.account_id === accountId);
      setStatus(row ? `status: ${row.status}` : 'brak rekordu publikacji');
    } finally { setBusy(false); }
  };

  return (
    <div className="card p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">Wystaw na Empik (Mirakl)</h3>
        <select className="input w-56" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {hasAccounts
            ? accounts.map((a) => <option key={a.account_id} value={a.account_id}>{a.account_name}</option>)
            : operators.map((o) => <option key={o.id} value={o.id}>{o.name} (klucz z .env)</option>)}
          {!hasAccounts && operators.length === 0 && <option value="">Brak operatorów Mirakl</option>}
        </select>
      </div>

      {/* AI toolbar */}
      <div className="rounded-lg bg-indigo-50 border border-indigo-100 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <span className="text-xs font-semibold text-indigo-700">Asystent AI:</span>
          <button className="btn-secondary btn-sm" onClick={runSuggestCategory} disabled={!operator || aiBusy !== null}>
            {aiBusy === 'category' ? 'Dopasowuję…' : '1. Dopasuj kategorię (AI)'}
          </button>
          <button
            className={`btn-sm px-3 font-semibold text-white ${aiBusy === 'fill' ? 'bg-indigo-500' : 'bg-indigo-600 hover:bg-indigo-700'} rounded-md disabled:opacity-50`}
            onClick={runAiFill}
            disabled={!form.categoryCode || aiBusy !== null}
          >
            {aiBusy === 'fill' ? '✨ Wypełniam formularz…' : '2. Wypełnij formularz (AI)'}
          </button>
        </div>
        {aiBusy === 'fill' && (
          <div className="h-1 w-full bg-indigo-500 animate-pulse" />
        )}
      </div>

      {/* Basic fields */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">Tytuł</label>
          {aiBusy === 'fill' ? <Skel /> : (
            <input className="input" value={form.title} onChange={(e) => set({ title: e.target.value })} />
          )}
        </div>
        <div>
          <label className="label">SKU sklepu</label>
          <input className="input" value={form.sku} onChange={(e) => set({ sku: e.target.value })} />
        </div>
        <div>
          <label className="label">EAN</label>
          <input className="input" value={form.ean} onChange={(e) => set({ ean: e.target.value })} />
        </div>
        <div>
          <label className="label">Cena (zł)</label>
          <input type="number" step="0.01" className="input" value={form.price}
            onChange={(e) => set({ price: parseFloat(e.target.value) || 0 })} />
        </div>
        <div>
          <label className="label">Ilość</label>
          <input type="number" className="input" value={form.quantity}
            onChange={(e) => set({ quantity: parseInt(e.target.value) || 0 })} />
        </div>
        <div>
          <label className="label">Stan</label>
          <select className="input" value={form.condition}
            onChange={(e) => set({ condition: e.target.value as 'NEW' | 'USED' })}>
            <option value="NEW">Nowy</option>
            <option value="USED">Używany</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Opis</label>
          {aiBusy === 'fill' ? <Skel h="h-20" /> : (
            <textarea className="input min-h-[80px]" value={form.description}
              onChange={(e) => set({ description: e.target.value })} />
          )}
        </div>
      </div>

      {/* Category picker */}
      <div className="space-y-2">
        <label className="label">Kategoria Empik</label>
        <div className="flex gap-2">
          <input className="input flex-1" value={phrase} placeholder="Szukaj kategorii…"
            onChange={(e) => setPhrase(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchCategories(); } }} />
          <button className="btn-secondary btn-sm" onClick={searchCategories} disabled={!operator}>Szukaj</button>
        </div>
        {form.categoryCode && (
          <p className="text-xs text-green-700">Wybrano: {form.categoryLabel} <span className="font-mono text-gray-400">({form.categoryCode})</span></p>
        )}
        {categories.length > 0 && (
          <ul className="border border-gray-200 rounded-lg divide-y max-h-48 overflow-auto">
            {categories.map((c) => (
              <li key={c.code}>
                <button className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50"
                  onClick={() => selectCategory(c)}>
                  {c.label} <span className="font-mono text-xs text-gray-400">{c.code}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Dynamic attributes */}
      {loadingAttrs ? (
        <p className="text-sm text-gray-400">Ładowanie atrybutów…</p>
      ) : aiBusy === 'fill' && attributes.length > 0 ? (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-indigo-500 uppercase">Atrybuty kategorii — wypełniam…</h4>
          <div className="grid grid-cols-2 gap-3">
            {attributes.map((a) => (
              <div key={a.code}>
                <label className="label">{a.label}{a.required && <span className="text-red-500"> *</span>}</label>
                <Skel />
              </div>
            ))}
          </div>
        </div>
      ) : attributes.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-gray-500 uppercase">Atrybuty kategorii</h4>
          <div className="grid grid-cols-2 gap-3">
            {attributes.map((a) => (
              <div key={a.code}>
                <label className="label">
                  {a.label}{a.required && <span className="text-red-500"> *</span>}
                </label>
                {a.values && a.values.length > 0 ? (
                  <select className="input"
                    value={(form.attributes[a.code] as string) || ''}
                    onChange={(e) => setAttr(a.code, e.target.value)}>
                    <option value="">—</option>
                    {a.values.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
                  </select>
                ) : a.type === 'MEDIA' ? (
                  <div className="flex items-center gap-2">
                    {(() => {
                      const url = (form.attributes[a.code] as string) || '';
                      return url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt="" className="w-10 h-10 object-contain bg-gray-50 rounded border shrink-0" />
                      ) : <div className="w-10 h-10 rounded border border-dashed border-gray-200 shrink-0" />;
                    })()}
                    <input className="input flex-1 text-xs" placeholder="URL zdjęcia"
                      value={(form.attributes[a.code] as string) || ''}
                      onChange={(e) => setAttr(a.code, e.target.value)} />
                  </div>
                ) : (
                  <input className="input"
                    value={(form.attributes[a.code] as string) || ''}
                    onChange={(e) => setAttr(a.code, e.target.value)} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {status && (
        <div className="text-sm rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-gray-700">{status}</div>
      )}

      <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
        <button className="btn-secondary btn-sm" onClick={handleSaveDraft} disabled={busy}>Zapisz szkic</button>
        {draftId && <button className="btn-secondary btn-sm" onClick={handleSync} disabled={busy}>Sprawdź status</button>}
        <button className="btn-primary btn-sm" onClick={handlePublish} disabled={busy || !accountId}>
          {busy ? '…' : 'Wystaw na Empik'}
        </button>
      </div>
    </div>
  );
}
