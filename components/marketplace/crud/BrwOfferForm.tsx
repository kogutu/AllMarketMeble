'use client';

/**
 * Black Red White (Mirakl) — samodzielny formularz CRUD oferty.
 * Operator `brw` wpisany na stałe. Pełna, niezależna logika (żadnej wspólnej bazy z Empik/Allegro/Kaufland) —
 * edycja tego pliku nie wpływa na pozostałe rynki. Wzorowane na components/offers/MiraklForm.tsx.
 */

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import type { MebleProduct, MiraklFormData } from '@/types';
import CrudOverlay from './CrudOverlay';

const OPERATOR = 'brw';             // ← stały operator tego formularza
const MP_NAME = 'Black Red White';

interface MiraklAccount { account_id: string; account_name: string; operator: string | null; }
interface Category { code: string; label: string; leaf: boolean; }
interface Attribute {
  code: string; label: string; type: string; required: boolean;
  multiple?: boolean; values?: { code: string; label: string }[];
}

function Skel({ h = 'h-9' }: { h?: string }) {
  return <div className={`w-full ${h} rounded-md bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%] animate-pulse`} />;
}

function safeJson(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s); } catch { return null; }
}

/** Extract missingAttributes codes from a publish error detail string. */
function parseMissing(details?: string): string[] {
  if (!details) return [];
  const m = /"missingAttributes":\s*\[(.*?)\]/.exec(String(details));
  if (!m) return [];
  return m[1].split(',').map((s) => s.replace(/["'\s]/g, '')).filter(Boolean);
}

export default function BrwOfferForm({ product }: { product: MebleProduct }) {
  const [accounts, setAccounts] = useState<MiraklAccount[]>([]);
  const [accountId, setAccountId] = useState('');
  const [hasOperator, setHasOperator] = useState(false);

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
  const [attrsLoadedFor, setAttrsLoadedFor] = useState('');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const autoSuggestedRef = useRef(false);
  const autoFillRef = useRef(false);
  const aiDisabledRef = useRef(false); // true = odtworzono draft → nie odpalaj AI automatycznie
  const lastSavedCatRef = useRef('');
  const categoryMappingRef = useRef<Record<string, string>>({});

  const operator = OPERATOR;
  const hasAccounts = accounts.length > 0;

  useEffect(() => {
    fetch('/api/mirakl/accounts')
      .then((r) => r.json())
      .then((d) => {
        const accs: MiraklAccount[] = (d.accounts || []).filter((a: MiraklAccount) => a.operator === OPERATOR);
        const ops: { id: string }[] = d.operators || [];
        setAccounts(accs);
        setHasOperator(ops.some((o) => o.id === OPERATOR) || accs.length > 0);
        if (accs[0]) setAccountId(accs[0].account_id);
        else setAccountId(OPERATOR);
      })
      .catch(() => {});
    fetch(`/api/mirakl/category-mapping?operator=${OPERATOR}`)
      .then((r) => r.json())
      .then((d) => { if (d.mapping) categoryMappingRef.current = d.mapping; })
      .catch(() => {});
  }, []);

  // Wczytaj istniejący szkic (jeśli był już zapisany po wypełnieniu AI) — wtedy pomijamy ponowne AI.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/offers?typesense_id=${encodeURIComponent(String(product.id))}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const drafts = ((d.offers || []) as { id: number; marketplace: string; form_data: unknown }[])
          .filter((o) => o.marketplace === 'mirakl');
        let picked: { id: number; fd: Record<string, unknown> } | null = null;
        for (const o of drafts) {
          const fd = (typeof o.form_data === 'string' ? safeJson(o.form_data) : o.form_data) as Record<string, unknown> | null;
          if (!fd) continue;
          if (fd.operator === OPERATOR) { picked = { id: o.id, fd }; break; }
          if (!fd.operator && !picked) picked = { id: o.id, fd };
        }
        if (picked && picked.fd.categoryCode) {
          aiDisabledRef.current = true;
          autoSuggestedRef.current = true;
          autoFillRef.current = true;
          setDraftId(picked.id);
          lastSavedCatRef.current = String(picked.fd.categoryCode);
          setForm((f) => ({ ...f, ...(picked!.fd as Partial<MiraklFormData>) }));
          loadAttributes(String(picked.fd.categoryCode));
          toast.success('Wczytano zapisany szkic — pomijam AI', { id: 'brw-draft-restored' });
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setDraftLoaded(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (patch: Partial<MiraklFormData>) => setForm((f) => ({ ...f, ...patch }));

  // Producent/Marka zawsze = nasza marka (z .env DEFAULT_PRODUCENT_MARKA).
  const BRAND = process.env.NEXT_PUBLIC_DEFAULT_PRODUCENT_MARKA || 'Mebel-Partner';
  const isBrandAttr = (a: Attribute) => /producent|marka|brand/i.test(a.code) || /producent|marka/i.test(a.label);
  const isSetAttr = (a: Attribute) => /zestaw|komplet/i.test(`${a.code} ${a.label}`);
  const isMiraklCatAttr = (a: Attribute) => /miraklcategory|mirakl.?category|struktura.*gold/i.test(a.code);

  // Wymagane atrybuty wypełniane deterministycznie z danych formularza (po etykietach):
  //  pełny tytuł ← tytuł, opis ← opis, numer katalogowy ← EAN/SKU, stawka VAT ← kod „23%”.
  const isTitleAttr = (a: Attribute) => /tytu[łl]/i.test(`${a.code} ${a.label}`) && !(a.values && a.values.length);
  const isDescAttr = (a: Attribute) => a.type === 'LONG_TEXT' || (/\bopis\b/i.test(`${a.code} ${a.label}`) && !(a.values && a.values.length));
  const isCatalogAttr = (a: Attribute) => /numer katalog|catalog_code|kod produktu/i.test(`${a.code} ${a.label}`);
  const isVatAttr = (a: Attribute) => /\bvat\b|stawka vat/i.test(`${a.code} ${a.label}`) && !!(a.values && a.values.length);
  const isDerivableReq = (a: Attribute) => a.required && (isTitleAttr(a) || isDescAttr(a) || isCatalogAttr(a) || isVatAttr(a));

  const requiredDefaults = (
    attrs: Attribute[],
    vals: { title?: string; description?: string; ean?: string; sku?: string }
  ): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const a of attrs) {
      if (!a.required) continue;
      if (isVatAttr(a)) { const v = a.values!.find((x) => /23/.test(x.label) || /23/.test(x.code)); if (v) out[a.code] = v.code; }
      else if (isCatalogAttr(a)) out[a.code] = String(vals.ean || vals.sku || '').slice(0, 26);
      else if (isTitleAttr(a)) { if (vals.title) out[a.code] = vals.title; }
      else if (isDescAttr(a)) { if (vals.description) out[a.code] = vals.description; }
    }
    return out;
  };

  // Pola znane z góry (marka/producent/zestaw oraz wymagane wyprowadzalne) nie czekają na AI — bez skeletonu.
  const isPrefilledAttr = (a: Attribute) => isBrandAttr(a) || isSetAttr(a) || isDerivableReq(a);
  const brandValueFor = (a: Attribute): string => {
    if (a.values && a.values.length) {
      const m = a.values.find((v) =>
        /mebel[-\s]?partner/i.test(v.label) || /mebel[-\s]?partner/i.test(v.code));
      return m?.code ?? BRAND;
    }
    return BRAND;
  };
  const brandDefaults = (attrs: Attribute[]): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const a of attrs) if (isBrandAttr(a)) out[a.code] = brandValueFor(a);
    return out;
  };

  const INSTRUKCJA_UZYTKOWANIA_URL = 'https://www.mebel-partner.pl/media/tkaniny_podstawy/INSTRUKCJA%20U%C5%BBYTKOWANIA%20-%20v%201.0.pdf';

  /** Wypełnia pola dokumentów PDF z danych produktu (Typesense extra_json/attrs). */
  const documentDefaults = (attrs: Attribute[]): Record<string, string> => {
    const extra = (product as unknown as Record<string, unknown>);
    const attrs_ = (product.attrs || {}) as Record<string, unknown>;
    const montazu = String(extra.instrukcja_montazu ?? attrs_.instrukcja_montazu ?? '');
    const uzytkowania = String(extra.instrukcja_uzytkowania ?? attrs_.instrukcja_uzytkowania ?? '') || INSTRUKCJA_UZYTKOWANIA_URL;
    const out: Record<string, string> = {};
    for (const a of attrs) {
      const s = `${a.code} ${a.label}`;
      if (/pdfInstruction|Instrukcja PDF/i.test(s)) {
        if (montazu) out[a.code] = montazu;
      } else if (/safetyAndOperating|bezpiecze[nń]stwa.*obs[łl]ugi/i.test(s)) {
        out[a.code] = uzytkowania;
      }
    }
    return out;
  };

  /** Zwraca wartość miraklCategory z mappingu category_id → value (brwmapping_category.json).
   *  Przechodzi przez wszystkie product.cats aż znajdzie mapping. */
  const categoryDefaults = (attrs: Attribute[]): Record<string, string> => {
    const catValue = (product.cats ?? [])
      .map((c) => c.split('_')[0])
      .map((id) => categoryMappingRef.current[id])
      .find(Boolean);
    if (!catValue) return {};
    const out: Record<string, string> = {};
    for (const a of attrs) {
      if (!isMiraklCatAttr(a) || !a.values?.length) continue;
      const match = a.values.find((v) => v.code === catValue || v.label === catValue) ?? a.values[0];
      if (match) out[a.code] = match.code;
    }
    return out;
  };

  /** Mapuje dane produktu na atrybuty BRW z normalizacją do listy dozwolonych wartości. */
  const productDefaults = (attrs: Attribute[]): Record<string, string> => {
    const norm = (s: string) => (s || '').toLowerCase()
      .replace(/ą/g,'a').replace(/ć/g,'c').replace(/ę/g,'e').replace(/ł/g,'l')
      .replace(/ń/g,'n').replace(/ó/g,'o').replace(/ś/g,'s').replace(/[źż]/g,'z')
      .replace(/[^a-z0-9]+/g,' ').trim();
    const bestMatch = (a: Attribute, search: string): string | undefined => {
      if (!a.values?.length || !search) return undefined;
      const q = norm(search);
      return (
        a.values.find((v) => norm(v.label) === q || norm(v.code) === q)?.code ??
        a.values.find((v) => q.includes(norm(v.label)) && norm(v.label).length >= 3)?.code ??
        a.values.find((v) => norm(v.label).includes(q) && q.length >= 3)?.code
      );
    };
    const extra = (product.attrs || {}) as Record<string, unknown>;
    const str = (k: string) => String(extra[k] ?? '');
    const out: Record<string, string> = {};
    // Kolor główny produktu — z danych koloru produktu
    const mainColor = product.color?.name || str('kolor') || str('kolor_glowny');
    // Kolor ramy — z atrybutów produktu
    const frameColor = str('kolor_ramy') || str('kolor_podstawy') || str('kolor_nogi');

    for (const a of attrs) {
      const c = a.code;
      if (/key-kolor$/.test(c)) {
        const v = bestMatch(a, mainColor);
        if (v) out[c] = v;
      } else if (/key-kolor_siedziska/.test(c)) {
        const v = bestMatch(a, str('kolor_siedziska') || mainColor);
        if (v) out[c] = v;
      } else if (/key-kolor_obicia/.test(c)) {
        const v = bestMatch(a, str('kolor_obicia') || mainColor);
        if (v) out[c] = v;
      } else if (/key-kolor_ramy/.test(c)) {
        const v = bestMatch(a, frameColor || mainColor);
        if (v) out[c] = v;
      } else if (/key-mat_obicia/.test(c)) {
        const v = bestMatch(a, str('mat_obicia') || str('material_obicia') || str('tkanina'));
        if (v) out[c] = v;
      } else if (/key-mat_ramy/.test(c)) {
        // Próbuj z atrybutów, potem wyciągnij z nazwy/opisu produktu
        const fromAttrs = str('mat_ramy') || str('material_ramy') || str('material_nogi') || str('material');
        const fromName = (() => {
          const n = `${product.name} ${product.description || ''} ${Object.values(extra).join(' ')}`.toLowerCase();
          if (/\bdrewn|\bdąb\b|\bsosn|\borzech\b|\bbuk\b|\bdrew/i.test(n)) return 'drewno';
          if (/\bstal\b|\bchrom|\bmetal|\bsteel/i.test(n)) return 'metal';
          if (/\bmdf\b/i.test(n)) return 'mdf';
          if (/\bsklejk/i.test(n)) return 'sklejka';
          if (/\btworzywo|\bplastik|\bpolipropylen/i.test(n)) return 'tworzywo sztuczne';
          return '';
        })();
        const v = bestMatch(a, fromAttrs || fromName);
        if (v) out[c] = v;
      } else if (/key-liczba_sztuk_w_komplecie/.test(c)) {
        // Liczba sztuk w komplecie — z atrybutu lub domyślnie 1
        const qty = String(str('liczba_sztuk_w_komplecie') || str('ilosc_w_komplecie') || '1');
        const v = a.values?.find((x) => String(x.code) === qty || String(x.label) === qty)?.code ?? '1';
        out[c] = v;
      } else if (/key-glebokosc_siedziska/.test(c)) {
        const v = str('glebokosc_siedziska') || str('glebokosc_siedziska_cm');
        if (v) out[c] = v;
      } else if (/key-szerokosc_siedziska/.test(c)) {
        const v = str('szerokosc_siedziska') || str('szerokosc_siedziska_cm');
        if (v) out[c] = v;
      }
    }
    return out;
  };

  const gallery = product.gallery_images?.length ? product.gallery_images : (product.img ? [product.img] : []);
  const isCertMedia = (a: Attribute) => /aghl|certyfikat|gpsr|instrukcj/i.test(`${a.code} ${a.label}`);
  const additionalIndex = (a: Attribute): number | null => {
    const s = `${a.code} ${a.label}`;
    // "Dodatkowe zdjęcia N" (Empik) OR "Zdjęcia_N" / "photos_N" (BRW) OR anything ending _N / N
    const m = s.match(/(?:dodatkow\w*\D*)(\d+)/i) ?? s.match(/(?:zdj\w*|photo\w*)[\s_](\d+)/i) ?? s.match(/_(\d+)\s*$/);
    return m ? parseInt(m[1]) : null;
  };
  const isPhotoAttr = (a: Attribute) => /photos?_?\d|zdj\w*_?\d/i.test(`${a.code} ${a.label}`);
  const imageDefaults = (attrs: Attribute[]): Record<string, string> => {
    if (gallery.length === 0) return {};
    const out: Record<string, string> = {};
    const media = attrs.filter((a) => a.type === 'MEDIA' && !isCertMedia(a) && isPhotoAttr(a));
    const numbered = media.filter((a) => additionalIndex(a) != null)
      .sort((x, y) => (additionalIndex(x)! - additionalIndex(y)!));
    const unnumbered = media.filter((a) => additionalIndex(a) == null);

    if (numbered.length > 0) {
      // BRW-style: Zdjęcia_1…N — index 1 = gallery[0], index 2 = gallery[1], itd.
      const base = additionalIndex(numbered[0])! - 1; // offset (zwykle 0 gdy zaczyna od _1)
      numbered.forEach((a) => {
        const idx = additionalIndex(a)! - 1 - base;
        const img = gallery[idx];
        if (img) out[a.code] = img;
      });
    }
    // Empik-style: jeden "main" (bez indeksu) + "Dodatkowe N" (z indeksem) w numbered
    if (unnumbered.length > 0) {
      if (unnumbered[0] && gallery[0]) out[unnumbered[0].code] = gallery[0];
    }
    return out;
  };

  const searchCategories = async () => {
    if (!phrase.trim()) return;
    const res = await fetch(`/api/mirakl/categories?operator=${operator}&accountId=${accountId}&phrase=${encodeURIComponent(phrase)}`);
    const d = await res.json();
    setCategories(d.categories || []);
  };

  const loadAttributes = async (code: string) => {
    setLoadingAttrs(true);
    autoFillRef.current = false; // każda nowa kategoria → ponowne auto-wypełnienie AI
    try {
      const res = await fetch(`/api/mirakl/categories/${encodeURIComponent(code)}/attributes?operator=${operator}&accountId=${accountId}`);
      const d = await res.json();
      const SKIP_ATTRS = new Set(['sku', 'product-id', 'product-id-type', 'price', 'state']);
      let attrs: Attribute[] = (d.attributes || []).filter((a: Attribute) => !SKIP_ATTRS.has(a.code));

      // Doładuj wymagane classificationstore atrybuty których API nie zwraca.
      // Używamy aktualnej ścieżki kategorii (miraklCategory) z mappingu lub etykiety.
      const catPath = categoryMappingRef.current[(product.cats ?? []).map(c => c.split('_')[0]).find(id => categoryMappingRef.current[id]) ?? ''] || form.categoryLabel;
      if (catPath) {
        const reqRes = await fetch(`/api/mirakl/required-attrs?operator=${operator}&categoryPath=${encodeURIComponent(catPath)}`);
        const reqData = await reqRes.json();
        const reqAttrs: Attribute[] = reqData.attributes || [];
        const existing = new Set(attrs.map((a) => a.code));
        attrs = [...attrs, ...reqAttrs.filter((a) => !existing.has(a.code))];
      }

      setAttributes(attrs);
      setForm((f) => {
        const defaults = {
          ...brandDefaults(attrs),
          ...imageDefaults(attrs),
          ...requiredDefaults(attrs, { title: f.title, description: f.description, ean: f.ean, sku: f.sku }),
        };
        return {
          ...f, attributes: {
            ...defaults,
            ...f.attributes,            // draft może nadpisać defaults
            ...productDefaults(attrs),  // kolor/materiał/liczba_sztuk z produktu — nadpisują draft
            ...categoryDefaults(attrs), // miraklCategory ZAWSZE z mappingu — nadpisuje draft
            ...documentDefaults(attrs), // instrukcje ZAWSZE z produktu — nadpisują draft
          },
        };
      });
      setAttrsLoadedFor(code);
    } finally {
      setLoadingAttrs(false);
    }
  };

  const selectCategory = async (c: Category) => {
    aiDisabledRef.current = false; // ręczna zmiana kategorii → pozwól AI uzupełnić nową kategorię
    set({ categoryCode: c.code, categoryLabel: c.label });
    setCategories([]);
    setPhrase(c.label);
    await loadAttributes(c.code);
  };

  const runSuggestCategory = async () => {
    aiDisabledRef.current = false; // ręczne kliknięcie AI → wznów automatyczne wypełnianie
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
      setForm((f) => {
        const title = d.title || f.title;
        const description = d.description || f.description;
        return {
          ...f,
          title,
          description,
          attributes: {
            ...f.attributes,
            ...(d.attributes || {}),
            ...brandDefaults(attributes),
            ...imageDefaults(attributes),
            // Wymagane pola deterministyczne mają pierwszeństwo nad (czasem pustym) wynikiem AI.
            ...requiredDefaults(attributes, { title, description, ean: f.ean, sku: f.sku }),
            // Kolor/materiał/liczba_sztuk z danych produktu (normalizowane do listy BRW).
            ...productDefaults(attributes),
            // Kategoria Mirakl (miraklCategory/STR_GOLD) — zawsze z listy, AI nie musi jej znać.
            ...categoryDefaults(attributes),
            // Instrukcje PDF — zawsze z produktu/domyślne.
            ...documentDefaults(attributes),
          },
        };
      });
      toast.success('AI wypełniło formularz');
    } catch {
      toast.error('Błąd wypełniania AI');
    } finally {
      setAiBusy(null);
    }
  };

  // Auto-dopasowanie kategorii AI — dopiero PO sprawdzeniu draftu i tylko gdy nie odtworzono danych.
  useEffect(() => {
    if (draftLoaded && !aiDisabledRef.current && !form.categoryCode && !autoSuggestedRef.current) {
      autoSuggestedRef.current = true;
      runSuggestCategory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftLoaded]);

  useEffect(() => {
    if (form.categoryCode && form.categoryCode !== lastSavedCatRef.current) {
      lastSavedCatRef.current = form.categoryCode;
      saveDraft().then((id) => { if (id) toast.success('Zapisano szkic z kategorią', { id: 'brw-draft' }); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.categoryCode]);

  // Po dopasowaniu kategorii i załadowaniu atrybutów → automatycznie uruchom AI „Wypełnij formularz”.
  useEffect(() => {
    if (form.categoryCode && attrsLoadedFor === form.categoryCode && !autoFillRef.current && !aiDisabledRef.current && aiBusy === null) {
      autoFillRef.current = true;
      runAiFill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attrsLoadedFor, form.categoryCode]);

  const setAttr = (code: string, value: string | string[]) =>
    setForm((f) => ({ ...f, attributes: { ...f.attributes, [code]: value } }));

  // Czy wymagany atrybut jest pusty (do walidacji + podświetlenia na czerwono).
  const isAttrEmpty = (a: Attribute): boolean => {
    const v = form.attributes[a.code];
    return !v || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '');
  };
  const missingRequired = (): Attribute[] => attributes.filter((a) => a.required && isAttrEmpty(a));

  // Pojedyncze pole atrybutu (select / media / tekst) — używane w obu trybach renderowania.
  const renderAttr = (a: Attribute) => {
    const invalid = a.required && isAttrEmpty(a);
    const cls = `input${invalid ? ' border-red-400 ring-1 ring-red-200' : ''}${!isAttrEmpty(a) ? ' is-filled' : ''}`;
    if (a.values && a.values.length > 0) {
      return (
        <select className={cls} value={(form.attributes[a.code] as string) || ''}
          onChange={(e) => setAttr(a.code, e.target.value)}>
          <option value="">—</option>
          {a.values.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
        </select>
      );
    }
    if (a.type === 'MEDIA') {
      const url = (form.attributes[a.code] as string) || '';
      return (
        <div className="flex items-center gap-2">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="w-10 h-10 object-contain bg-gray-50 rounded border shrink-0" />
          ) : <div className="w-10 h-10 rounded border border-dashed border-gray-200 shrink-0" />}
          <input className={`${cls} flex-1 text-xs`} placeholder="URL zdjęcia"
            value={url} onChange={(e) => setAttr(a.code, e.target.value)} />
        </div>
      );
    }
    return (
      <input className={cls} value={(form.attributes[a.code] as string) || ''}
        onChange={(e) => setAttr(a.code, e.target.value)} />
    );
  };

  const saveDraft = async (): Promise<number | null> => {
    const res = await fetch('/api/offers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typesense_id: String(product.id),
        typesense_collection: process.env.NEXT_PUBLIC_TYPESENSE_COLLECTION || 'meble',
        marketplace: 'mirakl',
        form_data: { ...form, operator: OPERATOR },
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
    if (!accountId) { toast.error(`Wybierz konto ${MP_NAME}`); return; }
    if (!form.categoryCode) { toast.error(`Wybierz kategorię ${MP_NAME}`); return; }
    if (!form.ean?.trim()) { toast.error('Uzupełnij EAN'); return; }
    // Walidacja pól wymaganych (z gwiazdką) — nie pozwalamy wystawić z pustymi wymaganymi atrybutami.
    const miss = missingRequired();
    if (miss.length) {
      const labels = miss.map((a) => a.label);
      toast.error('Uzupełnij wymagane pola: ' + labels.join(', '));
      setStatus('Brak wymaganych pól: ' + labels.join(', '));
      document.getElementById(`attr-${miss[0].code}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
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
        toast.success(`Wysłano do ${MP_NAME} (import w toku)`);
        setStatus('pending — import produktu i oferty zgłoszony, użyj „Sprawdź status”.');
      } else {
        const missing = parseMissing(d.details);
        if (missing.length) {
          const labels = missing.map((c) => attributes.find((a) => a.code === c)?.label || c);
          toast.error('Uzupełnij wymagane pola: ' + labels.join(', '));
          setStatus('Brak wymaganych atrybutów: ' + labels.join(', '));
        } else {
          toast.error('Błąd publikacji');
          setStatus(`error: ${d.details || d.error || 'nieznany'}`);
        }
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

  const handleWithdraw = async () => {
    if (!form.sku) { toast.error('Brak SKU oferty'); return; }
    if (!confirm(`Wycofać ofertę ${form.sku} z ${MP_NAME}?`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/marketplace/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: OPERATOR, ref: form.sku, accountId, meta: { operator: OPERATOR } }),
      });
      const d = await res.json();
      if (res.ok && d.success) { toast.success(`Wycofano z ${MP_NAME}`); setStatus('withdrawn — oferta usunięta z marketplace'); }
      else { toast.error('Błąd wycofania'); setStatus(`error: ${d.details || d.error || 'nieznany'}`); }
    } finally { setBusy(false); }
  };

  const reqMissing = attributes.length ? missingRequired() : [];
  const overlayBusy = aiBusy !== null || loadingAttrs || busy;
  const overlayLabel = aiBusy === 'category' ? 'AI dopasowuje kategorię…'
    : aiBusy === 'fill' ? 'AI wypełnia formularz…'
    : loadingAttrs ? 'Ładowanie atrybutów kategorii…'
    : 'Przetwarzanie…';

  return (
    <div className="card p-5 space-y-5 relative">
      <CrudOverlay show={overlayBusy} label={overlayLabel} accent="red" />
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">Wystaw na {MP_NAME} (Mirakl)</h3>
        <select className="input w-56" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {hasAccounts
            ? accounts.map((a) => <option key={a.account_id} value={a.account_id}>{a.account_name}</option>)
            : <option value={OPERATOR}>{MP_NAME} (klucz z .env)</option>}
        </select>
      </div>

      {!hasOperator && (
        <div className="text-xs rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-700">
          Brak skonfigurowanego operatora „{OPERATOR}” — używam klucza z .env.
        </div>
      )}

      {/* AI toolbar */}
      <div className="rounded-lg bg-red-50 border border-red-100 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <span className="text-xs font-semibold text-red-700">Asystent AI:</span>
          <button className="btn-secondary btn-sm" onClick={runSuggestCategory} disabled={aiBusy !== null}>
            {aiBusy === 'category' ? 'Dopasowuję…' : '1. Dopasuj kategorię (AI)'}
          </button>
          <button
            className={`btn-sm px-3 font-semibold text-white ${aiBusy === 'fill' ? 'bg-red-500' : 'bg-red-600 hover:bg-red-700'} rounded-md disabled:opacity-50`}
            onClick={runAiFill}
            disabled={!form.categoryCode || aiBusy !== null}
          >
            {aiBusy === 'fill' ? '✨ Wypełniam formularz…' : '2. Wypełnij formularz (AI)'}
          </button>
        </div>
        {aiBusy === 'fill' && <div className="h-1 w-full bg-red-500 animate-pulse" />}
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
                <button className="w-full text-left px-3 py-2 text-sm hover:bg-red-50"
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
          <h4 className="text-xs font-semibold text-red-500 uppercase">Atrybuty kategorii — wypełniam…</h4>
          <div className="grid grid-cols-2 gap-3">
            {attributes.map((a) => (
              <div key={a.code} id={`attr-${a.code}`}>
                <label className="label">{a.label}{a.required && <span className="text-red-500"> *</span>}</label>
                {/* Producent/Marka/Zestaw znamy z góry → pokaż od razu, bez skeletonu. */}
                {isPrefilledAttr(a) ? renderAttr(a) : <Skel />}
              </div>
            ))}
          </div>
        </div>
      ) : attributes.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-gray-500 uppercase">Atrybuty kategorii</h4>
          <div className="grid grid-cols-2 gap-3">
            {attributes.map((a) => (
              <div key={a.code} id={`attr-${a.code}`}>
                <label className="label">
                  {a.label}{a.required && <span className="text-red-500"> *</span>}
                </label>
                {renderAttr(a)}
              </div>
            ))}
          </div>
        </div>
      )}

      {status && (
        <div className="text-sm rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-gray-700">{status}</div>
      )}

      {reqMissing.length > 0 && (
        <div className="text-xs rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-700">
          Uzupełnij wymagane pola ({reqMissing.length}): {reqMissing.map((a) => a.label).join(', ')}
        </div>
      )}

      <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-gray-100">
        <button className="btn-secondary btn-sm text-red-600 hover:bg-red-50 mr-auto" onClick={handleWithdraw} disabled={busy}>
          Wycofaj z {MP_NAME}
        </button>
        <button className="btn-secondary btn-sm" onClick={handleSaveDraft} disabled={busy}>Zapisz szkic</button>
        {draftId && <button className="btn-secondary btn-sm" onClick={handleSync} disabled={busy}>Sprawdź status</button>}
        <button className="btn-sm px-3 font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50"
          onClick={handlePublish} disabled={busy || !accountId || reqMissing.length > 0}
          title={reqMissing.length > 0 ? `Brakuje: ${reqMissing.map((a) => a.label).join(', ')}` : undefined}>
          {busy ? '…' : `Wystaw na ${MP_NAME}`}
        </button>
      </div>
    </div>
  );
}
