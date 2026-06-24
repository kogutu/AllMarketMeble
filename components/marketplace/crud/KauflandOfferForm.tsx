'use client';

/**
 * Kaufland — samodzielny formularz CRUD oferty (storefront PL).
 * Model Kaufland: oferta = "unit" dopasowywany po EAN do katalogu; brak atrybutów per kategoria.
 * Pełna, niezależna logika — edycja tego pliku nie wpływa na Empik/BRW/Allegro.
 */

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import type { MebleProduct } from '@/types';
import CrudOverlay from './CrudOverlay';

const SLUG = 'kaufland';
const MP_NAME = 'Kaufland';

interface Category { code: string; label: string; leaf: boolean; }
interface Option { id: number; name: string; isDefault: boolean; }

interface KForm {
  title: string;
  sku: string;
  ean: string;
  price: number;
  minimum_price: number | '';
  quantity: number;
  condition: string;
  handling_time: number;
  id_shipping_group: number | '';
  id_warehouse: number | '';
  categoryCode: string;
  categoryLabel: string;
}

function Skel({ h = 'h-9' }: { h?: string }) {
  return <div className={`w-full ${h} rounded-md bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%] animate-pulse`} />;
}

export default function KauflandOfferForm({ product }: { product: MebleProduct }) {
  const [form, setForm] = useState<KForm>(() => ({
    title: product.name,
    sku: product.sku || String(product.id),
    ean: product.ean || '',
    price: product.price_gross || 0,
    minimum_price: '',
    quantity: product.qty || 1,
    condition: 'NEW',
    handling_time: 1,
    id_shipping_group: '',
    id_warehouse: '',
    categoryCode: '',
    categoryLabel: '',
  }));

  const [phrase, setPhrase] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [shippingGroups, setShippingGroups] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState<null | 'category' | 'fill'>(null);
  const [status, setStatus] = useState<string | null>(null);
  const autoSuggestedRef = useRef(false);
  const autoFillForRef = useRef('');

  const set = (patch: Partial<KForm>) => setForm((f) => ({ ...f, ...patch }));

  // Load shipping groups + warehouses once (defaults to is_default).
  const loadOptions = async (categoryCode: string) => {
    setLoadingOpts(true);
    try {
      const res = await fetch(`/api/kaufland/categories/${encodeURIComponent(categoryCode || '1')}/attributes`);
      const d = await res.json();
      const sg: Option[] = d.shippingGroups || [];
      const wh: Option[] = d.warehouses || [];
      setShippingGroups(sg);
      setWarehouses(wh);
      setForm((f) => ({
        ...f,
        id_shipping_group: f.id_shipping_group || (sg.find((g) => g.isDefault) ?? sg[0])?.id || '',
        id_warehouse: f.id_warehouse || (wh.find((w) => w.isDefault) ?? wh[0])?.id || '',
      }));
    } finally {
      setLoadingOpts(false);
    }
  };

  useEffect(() => { loadOptions(''); /* load defaults early */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const searchCategories = async () => {
    if (!phrase.trim()) return;
    const res = await fetch(`/api/kaufland/categories?phrase=${encodeURIComponent(phrase)}`);
    const d = await res.json();
    setCategories(d.categories || []);
  };

  const selectCategory = (c: Category) => {
    set({ categoryCode: c.code, categoryLabel: c.label });
    setCategories([]);
    setPhrase(c.label);
  };

  const runSuggestCategory = async () => {
    setAiBusy('category');
    try {
      const res = await fetch('/api/kaufland/suggest-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: String(product.id) }),
      });
      const d = await res.json();
      if (d.categoryCode) {
        set({ categoryCode: d.categoryCode, categoryLabel: d.categoryLabel || d.categoryCode });
        setPhrase(d.categoryLabel || d.categoryCode);
        setCategories([]);
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

  const runAiFill = async () => {
    setAiBusy('fill');
    try {
      const res = await fetch('/api/kaufland/fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: String(product.id), categoryLabel: form.categoryLabel }),
      });
      const d = await res.json();
      if (d.error) { toast.error('Błąd AI: ' + (d.details || d.error)); return; }
      setForm((f) => ({ ...f, title: d.title || f.title, handling_time: d.handling_time || f.handling_time }));
      toast.success('AI wypełniło formularz');
    } catch {
      toast.error('Błąd wypełniania AI');
    } finally {
      setAiBusy(null);
    }
  };

  useEffect(() => {
    if (!autoSuggestedRef.current) {
      autoSuggestedRef.current = true;
      runSuggestCategory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Po dopasowaniu/wyborze kategorii → automatycznie uruchom AI „Wypełnij”.
  useEffect(() => {
    if (form.categoryCode && autoFillForRef.current !== form.categoryCode && aiBusy === null) {
      autoFillForRef.current = form.categoryCode;
      runAiFill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.categoryCode]);

  const saveDraft = async (): Promise<number | null> => {
    const res = await fetch('/api/offers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typesense_id: String(product.id),
        typesense_collection: process.env.NEXT_PUBLIC_TYPESENSE_COLLECTION || 'meble',
        marketplace: SLUG,
        form_data: form,
        title: form.title,
        description: '',
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
    if (!form.ean) { toast.error('Kaufland wymaga EAN (dopasowanie po EAN w katalogu)'); return; }
    if (!form.id_shipping_group || !form.id_warehouse) { toast.error('Wybierz grupę wysyłki i magazyn'); return; }
    setBusy(true);
    setStatus(null);
    try {
      const id = draftId ?? (await saveDraft());
      if (!id) { toast.error('Nie udało się zapisać szkicu'); return; }
      const res = await fetch(`/api/marketplace/publish/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: SLUG, formData: form, basePrice: product.price_gross }),
      });
      const d = await res.json();
      if (res.ok && d.success) {
        setUnitId(d.ref || null);
        toast.success(`Wystawiono na ${MP_NAME}`);
        setStatus(`active — unit ${d.ref}`);
      } else {
        toast.error('Błąd publikacji');
        setStatus(`error: ${d.details || d.error || 'nieznany'}`);
      }
    } finally { setBusy(false); }
  };

  const handleWithdraw = async () => {
    const ref = unitId;
    if (!ref) { toast.error('Brak ID unitu — wystaw ofertę najpierw'); return; }
    if (!confirm(`Wycofać ofertę (unit ${ref}) z ${MP_NAME}?`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/marketplace/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: SLUG, ref }),
      });
      const d = await res.json();
      if (res.ok && d.success) { toast.success(`Wycofano z ${MP_NAME}`); setUnitId(null); setStatus('withdrawn — unit usunięty'); }
      else { toast.error('Błąd wycofania'); setStatus(`error: ${d.details || d.error || 'nieznany'}`); }
    } finally { setBusy(false); }
  };

  const overlayBusy = aiBusy !== null || loadingOpts || busy;
  const overlayLabel = aiBusy === 'category' ? 'AI dopasowuje kategorię…'
    : aiBusy === 'fill' ? 'AI wypełnia formularz…'
    : loadingOpts ? 'Ładowanie opcji wysyłki/magazynu…'
    : 'Przetwarzanie…';

  return (
    <div className="card p-5 space-y-5 relative">
      <CrudOverlay show={overlayBusy} label={overlayLabel} accent="green" />
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">Wystaw na {MP_NAME} (storefront PL)</h3>
        <span className="text-xs text-gray-400">model: units (EAN-match)</span>
      </div>

      {/* AI toolbar */}
      <div className="rounded-lg bg-green-50 border border-green-100 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <span className="text-xs font-semibold text-green-700">Asystent AI:</span>
          <button className="btn-secondary btn-sm" onClick={runSuggestCategory} disabled={aiBusy !== null}>
            {aiBusy === 'category' ? 'Dopasowuję…' : '1. Dopasuj kategorię (AI)'}
          </button>
          <button
            className={`btn-sm px-3 font-semibold text-white ${aiBusy === 'fill' ? 'bg-green-500' : 'bg-green-600 hover:bg-green-700'} rounded-md disabled:opacity-50`}
            onClick={runAiFill}
            disabled={aiBusy !== null}
          >
            {aiBusy === 'fill' ? '✨ Wypełniam…' : '2. Wypełnij (AI)'}
          </button>
        </div>
        {aiBusy === 'fill' && <div className="h-1 w-full bg-green-500 animate-pulse" />}
      </div>

      {/* Basic fields */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">Tytuł / nota oferty</label>
          {aiBusy === 'fill' ? <Skel /> : (
            <input className="input" value={form.title} onChange={(e) => set({ title: e.target.value })} />
          )}
        </div>
        <div>
          <label className="label">SKU oferty (id_offer)</label>
          <input className="input" value={form.sku} onChange={(e) => set({ sku: e.target.value })} />
        </div>
        <div>
          <label className="label">EAN <span className="text-red-500">*</span></label>
          <input className="input" value={form.ean} onChange={(e) => set({ ean: e.target.value })} />
        </div>
        <div>
          <label className="label">Cena (zł)</label>
          <input type="number" step="0.01" className="input" value={form.price}
            onChange={(e) => set({ price: parseFloat(e.target.value) || 0 })} />
        </div>
        <div>
          <label className="label">Cena minimalna (zł, opcjonalnie)</label>
          <input type="number" step="0.01" className="input" value={form.minimum_price}
            onChange={(e) => set({ minimum_price: e.target.value === '' ? '' : parseFloat(e.target.value) })} />
        </div>
        <div>
          <label className="label">Ilość</label>
          <input type="number" className="input" value={form.quantity}
            onChange={(e) => set({ quantity: parseInt(e.target.value) || 0 })} />
        </div>
        <div>
          <label className="label">Stan</label>
          <select className="input" value={form.condition} onChange={(e) => set({ condition: e.target.value })}>
            <option value="NEW">Nowy</option>
            <option value="USED">Używany</option>
          </select>
        </div>
        <div>
          <label className="label">Czas przygotowania (dni)</label>
          <input type="number" min={0} className="input" value={form.handling_time}
            onChange={(e) => set({ handling_time: parseInt(e.target.value) || 0 })} />
        </div>
        <div>
          <label className="label">Grupa wysyłki</label>
          {loadingOpts ? <Skel /> : (
            <select className="input" value={form.id_shipping_group}
              onChange={(e) => set({ id_shipping_group: e.target.value === '' ? '' : parseInt(e.target.value) })}>
              <option value="">—</option>
              {shippingGroups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.isDefault ? ' (domyślna)' : ''}</option>)}
            </select>
          )}
        </div>
        <div>
          <label className="label">Magazyn</label>
          {loadingOpts ? <Skel /> : (
            <select className="input" value={form.id_warehouse}
              onChange={(e) => set({ id_warehouse: e.target.value === '' ? '' : parseInt(e.target.value) })}>
              <option value="">—</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}{w.isDefault ? ' (domyślny)' : ''}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Category picker */}
      <div className="space-y-2">
        <label className="label">Kategoria {MP_NAME}</label>
        <div className="flex gap-2">
          <input className="input flex-1" value={phrase} placeholder="Szukaj kategorii…"
            onChange={(e) => setPhrase(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchCategories(); } }} />
          <button className="btn-secondary btn-sm" onClick={searchCategories}>Szukaj</button>
        </div>
        {form.categoryCode && (
          <p className="text-xs text-green-700">Wybrano: {form.categoryLabel} <span className="font-mono text-gray-400">({form.categoryCode})</span></p>
        )}
        {categories.length > 0 && (
          <ul className="border border-gray-200 rounded-lg divide-y max-h-48 overflow-auto">
            {categories.map((c) => (
              <li key={c.code}>
                <button className="w-full text-left px-3 py-2 text-sm hover:bg-green-50" onClick={() => selectCategory(c)}>
                  {c.label} <span className="font-mono text-xs text-gray-400">{c.code}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {status && (
        <div className="text-sm rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-gray-700">{status}</div>
      )}

      <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-gray-100">
        <button className="btn-secondary btn-sm text-red-600 hover:bg-red-50 mr-auto" onClick={handleWithdraw} disabled={busy || !unitId}>
          Wycofaj z {MP_NAME}
        </button>
        <button className="btn-secondary btn-sm" onClick={handleSaveDraft} disabled={busy}>Zapisz szkic</button>
        <button className="btn-sm px-3 font-semibold text-white bg-green-600 hover:bg-green-700 rounded-md disabled:opacity-50"
          onClick={handlePublish} disabled={busy}>
          {busy ? '…' : `Wystaw na ${MP_NAME}`}
        </button>
      </div>
    </div>
  );
}
