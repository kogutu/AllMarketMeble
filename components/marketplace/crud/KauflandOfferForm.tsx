"use client";

/**
 * Kaufland — samodzielny formularz CRUD oferty (storefront PL).
 * Model Kaufland: oferta = "unit" dopasowywany po EAN do katalogu; brak atrybutów per kategoria.
 * Pełna, niezależna logika — edycja tego pliku nie wpływa na Empik/BRW/Allegro.
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import type { MebleProduct } from "@/types";
import { prefillKauflandAttributes } from "@/lib/marketplaces/kaufland/prefill";
import CrudOverlay from "./CrudOverlay";

const SLUG = "kaufland";
const MP_NAME = "Kaufland";

interface Category {
  code: string;
  label: string;
  leaf: boolean;
}
interface Option {
  id: number;
  name: string;
  isDefault: boolean;
}
interface KAttr {
  code: string;
  label: string;
  type: string;
  required: boolean;
  multiple?: boolean;
}

/** Werdykt Kauflandu co do danych produktowych — odpowiedź `/api/kaufland/product-data-status`. */
interface PdStatus {
  ready: boolean;
  status: string;
  notReadyReason: string | null;
  failReason: string | null;
  missing: string[];
  blocked: string[];
  declined: { attribute: string; state: string; message: string }[];
  pictures: { total: number; rejected: number };
  gpsr: boolean;
}

interface KForm {
  title: string;
  sku: string;
  ean: string;
  price: number;
  minimum_price: number | "";
  quantity: number;
  condition: string;
  handling_time: number;
  id_shipping_group: number | "";
  id_warehouse: number | "";
  categoryCode: string;
  categoryLabel: string;
  attributes: Record<string, string>;
  description: string;
  short_description: string;
  images: string[];
}

/** Wiersz z `/api/offers` — tylko pola, których tu potrzebujemy. */
interface OfferRow {
  id: number;
  marketplace?: string | null;
  account_id?: string | null;
  allegro_offer_id?: string | null;
  category_id?: string | null;
  form_data?: unknown;
}

/** Oferta (unit) odczytana z Kauflandu — `/api/kaufland/unit`. */
interface LiveUnit {
  idUnit: string | null;
  idOffer: string | null;
  ean: string | null;
  title: string | null;
  price: number | null;
  minimumPrice: number | null;
  quantity: number | null;
  condition: string | null;
  handlingTime: number | null;
  idShippingGroup: number | null;
  idWarehouse: number | null;
  status: string | null;
  isLive: boolean | null;
}

function Skel({ h = "h-9" }: { h?: string }) {
  return (
    <div
      className={`w-full ${h} rounded-md bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%] animate-pulse`}
    />
  );
}

export default function KauflandOfferForm({
  product,
}: {
  product: MebleProduct;
}) {
  const [form, setForm] = useState<KForm>(() => ({
    title: product.name,
    sku: product.sku || String(product.id),
    ean: product.ean || "",
    price: product.price_gross || 0,
    minimum_price: "",
    quantity: product.qty || 1,
    condition: "NEW",
    handling_time: 1,
    id_shipping_group: "",
    id_warehouse: "",
    categoryCode: "",
    categoryLabel: "",
    attributes: {},
    description: (product.description || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    short_description: "",
    images: product.gallery_images?.length
      ? product.gallery_images
      : product.img
        ? [product.img]
        : [],
  }));
  const [kAttributes, setKAttributes] = useState<KAttr[]>([]);
  // `?edit=1` z siatki produktów = oferta już jest na Kauflandzie, wchodzimy ją edytować.
  const editMode = useSearchParams().has("edit");
  const [loadingDraft, setLoadingDraft] = useState(true);

  const [phrase, setPhrase] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [shippingGroups, setShippingGroups] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [unitMeta, setUnitMeta] = useState<{
    status: string | null;
    isLive: boolean | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState<null | "category" | "fill">(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pdStatus, setPdStatus] = useState<PdStatus | null>(null);
  const [pdBusy, setPdBusy] = useState(false);
  const autoSuggestedRef = useRef(false);
  const autoFillForRef = useRef("");
  // Wczytany szkic/oferta → AI nie rusza automatycznie, żeby nie nadpisać zapisanych danych.
  const draftRestoredRef = useRef(false);
  const pdCheckedRef = useRef(false);

  const set = (patch: Partial<KForm>) => setForm((f) => ({ ...f, ...patch }));
  // Klasa podświetlenia pola z wprowadzoną wartością.
  const fc = (v: unknown) =>
    (Array.isArray(v) ? v.length > 0 : v !== "" && v != null && v !== 0)
      ? " is-filled"
      : "";

  // Load shipping groups, warehouses and product attributes.
  const loadOptions = async (categoryCode: string) => {
    setLoadingOpts(true);
    try {
      const res = await fetch(
        `/api/kaufland/categories/${encodeURIComponent(categoryCode || "1")}/attributes`,
      );
      const d = await res.json();
      const sg: Option[] = d.shippingGroups || [];
      const wh: Option[] = d.warehouses || [];
      const attrs: KAttr[] = d.attributes || [];
      setShippingGroups(sg);
      setWarehouses(wh);
      setKAttributes(attrs);
      const prefilled = prefillKauflandAttributes(product, attrs);
      setForm((f) => ({
        ...f,
        id_shipping_group:
          f.id_shipping_group ||
          (sg.find((g) => g.isDefault) ?? sg[0])?.id ||
          "",
        id_warehouse:
          f.id_warehouse || (wh.find((w) => w.isDefault) ?? wh[0])?.id || "",
        attributes: { ...prefilled, ...f.attributes },
      }));
    } finally {
      setLoadingOpts(false);
    }
  };

  // Opcje oferty i schemat atrybutów zależą od kategorii — przeładuj przy każdej jej zmianie.
  // Pusty kod przy wejściu = wczytanie samych grup wysyłki/magazynów (API podstawia kategorię
  // zastępczą); bez tego efektu atrybuty zostawały te z kategorii zastępczej, nie z wybranej.
  useEffect(() => {
    void loadOptions(form.categoryCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.categoryCode]);

  /**
   * Wczytanie istniejącej oferty. Bez tego wejście w edycję (`?edit=1`) renderowało świeży
   * formularz z danych produktu — zapisany szkic, unit i werdykt Kauflandu nie pojawiały się wcale.
   * Kolejność źródeł: lokalny szkic (`form_data`) → żywy unit z API Kauflandu.
   */
  useEffect(() => {
    let current = true;
    (async () => {
      try {
        const d = await fetch(
          `/api/offers?typesense_id=${encodeURIComponent(String(product.id))}`,
        ).then((r) => r.json());
        if (!current) return;

        const offers = (d?.offers || []) as OfferRow[];
        const offer =
          offers.find((o) => o.marketplace === SLUG || o.account_id === SLUG) ??
          null;
        // `accountOffers` dotyczy tylko pierwszej oferty w odpowiedzi (może być z Allegro),
        // więc rekordy publikacji bierzemy z mapy po id naszej oferty.
        type AccountRow = {
          account_id: string;
          allegro_offer_id: string | null;
        };
        const byOffer = (d?.offerAccountsMap || {}) as Record<
          string,
          AccountRow[]
        >;
        const accounts: AccountRow[] = offer
          ? (byOffer[String(offer.id)] ?? [])
          : Object.values(byOffer).flat();
        let ref =
          offer?.allegro_offer_id ||
          accounts.find((a) => a.account_id === SLUG)?.allegro_offer_id ||
          null;

        if (offer) {
          setDraftId(offer.id);
          let raw: unknown = offer.form_data;
          if (typeof raw === "string") {
            try {
              raw = JSON.parse(raw);
            } catch {
              raw = null;
            }
          }
          if (raw && typeof raw === "object") {
            const saved = raw as Partial<KForm>;
            draftRestoredRef.current = true;
            setForm((f) => ({
              ...f,
              ...saved,
              attributes: { ...f.attributes, ...(saved.attributes || {}) },
            }));
            if (saved.categoryCode) {
              // Kategoria pochodzi z zapisu — nie wołaj po nią AI ponownie.
              autoFillForRef.current = saved.categoryCode;
              setPhrase(saved.categoryLabel || saved.categoryCode);
            }
          } else if (offer.category_id) {
            setForm((f) => ({ ...f, categoryCode: String(offer.category_id) }));
          }
        }

        // Oferta mogła powstać poza formularzem (masowe dodawanie, synchronizacja) — wtedy
        // jedynym źródłem ceny, stanu i grupy wysyłki jest unit w API Kauflandu.
        if (ref || editMode) {
          const qs = ref
            ? `idUnit=${encodeURIComponent(ref)}`
            : `idOffer=${encodeURIComponent(product.sku || String(product.id))}`;
          const u = await fetch(`/api/kaufland/unit?${qs}`)
            .then((r) => r.json())
            .catch(() => null);
          if (!current) return;
          const unit = (u?.unit ?? null) as LiveUnit | null;
          if (unit) {
            ref = unit.idUnit || ref;
            setUnitMeta({ status: unit.status, isLive: unit.isLive });
            if (!draftRestoredRef.current) {
              draftRestoredRef.current = true; // stan z Kauflandu też jest danymi — AI go nie nadpisuje
              setForm((f) => ({
                ...f,
                title: unit.title || f.title,
                sku: unit.idOffer || f.sku,
                ean: unit.ean || f.ean,
                price: unit.price ?? f.price,
                minimum_price: unit.minimumPrice ?? f.minimum_price,
                quantity: unit.quantity ?? f.quantity,
                condition: unit.condition || f.condition,
                handling_time: unit.handlingTime ?? f.handling_time,
                id_shipping_group: unit.idShippingGroup ?? f.id_shipping_group,
                id_warehouse: unit.idWarehouse ?? f.id_warehouse,
              }));
            }
          }
        }
        if (ref) setUnitId(ref);
      } catch {
        /* brak szkicu / błąd API — formularz zostaje na danych produktu */
      } finally {
        if (current) setLoadingDraft(false);
      }
    })();
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const searchCategories = async () => {
    if (!phrase.trim()) return;
    const res = await fetch(
      `/api/kaufland/categories?phrase=${encodeURIComponent(phrase)}`,
    );
    const d = await res.json();
    setCategories(d.categories || []);
  };

  const selectCategory = (c: Category) => {
    set({ categoryCode: c.code, categoryLabel: c.label });
    setCategories([]);
    setPhrase(c.label);
  };

  const runSuggestCategory = async () => {
    setAiBusy("category");
    try {
      const res = await fetch("/api/kaufland/suggest-category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: String(product.id) }),
      });
      const d = await res.json();
      if (d.categoryCode) {
        set({
          categoryCode: d.categoryCode,
          categoryLabel: d.categoryLabel || d.categoryCode,
        });
        setPhrase(d.categoryLabel || d.categoryCode);
        setCategories([]);
        toast.success(
          `AI dopasowało kategorię: ${d.categoryLabel || d.categoryCode}`,
        );
      } else {
        toast("AI nie znalazło kategorii — wyszukaj ręcznie", { icon: "ℹ️" });
      }
    } catch {
      toast.error("Błąd dopasowania kategorii");
    } finally {
      setAiBusy(null);
    }
  };

  const runAiFill = async () => {
    setAiBusy("fill");
    try {
      const res = await fetch("/api/kaufland/fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: String(product.id),
          categoryCode: form.categoryCode,
          categoryLabel: form.categoryLabel,
        }),
      });
      const d = await res.json();
      if (d.error) {
        toast.error("Błąd AI: " + (d.details || d.error));
        return;
      }
      // Atrybuty przychodzą kluczowane kodami atrybutów TEJ kategorii — wpisujemy je do mapy
      // atrybutów, bo stamtąd lecą do product data i stamtąd renderuje je formularz.
      const aiAttrs = (d.attributes || {}) as Record<string, string>;
      setForm((f) => ({
        ...f,
        title: d.title || f.title,
        handling_time: d.handling_time || f.handling_time,
        ...(d.description ? { description: d.description } : {}),
        ...(d.short_description
          ? { short_description: d.short_description }
          : {}),
        attributes: { ...f.attributes, ...aiAttrs },
      }));
      toast.success("AI wypełniło formularz");
    } catch {
      toast.error("Błąd wypełniania AI");
    } finally {
      setAiBusy(null);
    }
  };

  // AI startuje dopiero po sprawdzeniu, czy jest co edytować — i nigdy, gdy coś wczytaliśmy.
  useEffect(() => {
    if (loadingDraft || autoSuggestedRef.current) return;
    autoSuggestedRef.current = true;
    if (draftRestoredRef.current) return;
    runSuggestCategory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingDraft]);

  // Po dopasowaniu/wyborze kategorii → automatycznie uruchom AI „Wypełnij”.
  useEffect(() => {
    if (loadingDraft) return;
    if (
      form.categoryCode &&
      autoFillForRef.current !== form.categoryCode &&
      aiBusy === null
    ) {
      autoFillForRef.current = form.categoryCode;
      runAiFill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.categoryCode, loadingDraft]);

  const saveDraft = async (): Promise<number | null> => {
    // Wystawiona oferta ma status `active`, więc POST /api/offers nie znalazłby jej jako szkicu
    // i wstawiłby duplikat — mając jej id aktualizujemy ten sam wiersz.
    const res = await fetch(
      draftId ? `/api/offers/${draftId}` : "/api/offers",
      {
        method: draftId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          typesense_id: String(product.id),
          typesense_collection:
            process.env.NEXT_PUBLIC_TYPESENSE_COLLECTION || "meble",
          marketplace: SLUG,
          form_data: form,
          title: form.title,
          description: "",
          price: form.price,
          quantity: form.quantity,
          category_id: form.categoryCode,
        }),
      },
    );
    const d = await res.json();
    if (d?.id) {
      setDraftId(d.id);
      return d.id;
    }
    return null;
  };

  const handleSaveDraft = async () => {
    setBusy(true);
    try {
      const id = await saveDraft();
      if (id) toast.success("Zapisano szkic");
      else toast.error("Błąd zapisu szkicu");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Odpytuje Kaufland, co faktycznie przyjął z wysłanych danych produktowych. Bez tego jedyną
   * informacją zwrotną jest ręczne przeglądanie Seller Center — a odrzucone zdjęcia czy brakujące
   * atrybuty widać tylko tam.
   */
  const checkProductData = async () => {
    if (!form.ean) return;
    setPdBusy(true);
    try {
      const d = await fetch(
        `/api/kaufland/product-data-status?ean=${encodeURIComponent(form.ean)}`,
      ).then((r) => r.json());
      setPdStatus(d?.ean ? d : null);
    } catch {
      setPdStatus(null);
    } finally {
      setPdBusy(false);
    }
  };

  // W edycji werdykt danych produktowych ma być od razu widoczny — wcześniej panel stał pusty
  // do ręcznego kliknięcia „Sprawdź w Kauflandzie".
  useEffect(() => {
    if (loadingDraft || pdCheckedRef.current) return;
    if (!form.ean || (!editMode && !unitId)) return;
    pdCheckedRef.current = true;
    void checkProductData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingDraft, form.ean, unitId, editMode]);

  const handlePublish = async () => {
    if (!form.ean) {
      toast.error("Kaufland wymaga EAN (dopasowanie po EAN w katalogu)");
      return;
    }
    if (!form.id_shipping_group || !form.id_warehouse) {
      toast.error("Wybierz grupę wysyłki i magazyn");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const id = draftId ?? (await saveDraft());
      if (!id) {
        toast.error("Nie udało się zapisać szkicu");
        return;
      }
      const res = await fetch(`/api/marketplace/publish/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: SLUG,
          formData: form,
          basePrice: product.price_gross,
        }),
      });
      const d = await res.json();
      if (res.ok && d.success) {
        const ref = d.ref || null;
        setUnitId(ref);
        toast.success(`Wystawiono na ${MP_NAME} (unit ${ref})`);
        setStatus(`success:${ref}`);
        // Kaufland weryfikuje dane produktowe asynchronicznie — pokaż od razu, co przyjął.
        void checkProductData();
      } else {
        toast.error("Błąd publikacji");
        setStatus(`error: ${d.details || d.error || "nieznany"}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleWithdraw = async () => {
    const ref = unitId;
    if (!ref) {
      toast.error("Brak ID unitu — wystaw ofertę najpierw");
      return;
    }
    if (!confirm(`Wycofać ofertę (unit ${ref}) z ${MP_NAME}?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/marketplace/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: SLUG, ref }),
      });
      const d = await res.json();
      if (res.ok && d.success) {
        toast.success(`Wycofano z ${MP_NAME}`);
        setUnitId(null);
        setStatus("withdrawn — unit usunięty");
      } else {
        toast.error("Błąd wycofania");
        setStatus(`error: ${d.details || d.error || "nieznany"}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const overlayBusy = aiBusy !== null || loadingOpts || busy || loadingDraft;
  const overlayLabel = loadingDraft
    ? "Wczytywanie oferty z Kauflandu…"
    : aiBusy === "category"
      ? "AI dopasowuje kategorię…"
      : aiBusy === "fill"
        ? "AI wypełnia formularz…"
        : loadingOpts
          ? "Ładowanie opcji wysyłki/magazynu…"
          : "Przetwarzanie…";

  return (
    <div className="card p-5 space-y-5 relative">
      <CrudOverlay show={overlayBusy} label={overlayLabel} accent="green" />
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">
          Wystaw na {MP_NAME} (storefront PL)
        </h3>
        <span className="text-xs text-gray-400">model: units (EAN-match)</span>
      </div>

      {/* AI toolbar */}
      <div className="rounded-lg bg-green-50 border border-green-100 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <span className="text-xs font-semibold text-green-700">
            Asystent AI:
          </span>
          <button
            className="btn-secondary btn-sm"
            onClick={runSuggestCategory}
            disabled={aiBusy !== null}
          >
            {aiBusy === "category"
              ? "Dopasowuję…"
              : "1. Dopasuj kategorię (AI)"}
          </button>
          <button
            className={`btn-sm px-3 font-semibold text-white ${aiBusy === "fill" ? "bg-green-500" : "bg-green-600 hover:bg-green-700"} rounded-md disabled:opacity-50`}
            onClick={runAiFill}
            disabled={aiBusy !== null}
          >
            {aiBusy === "fill" ? "✨ Wypełniam…" : "2. Wypełnij (AI)"}
          </button>
        </div>
        {aiBusy === "fill" && (
          <div className="h-1 w-full bg-green-500 animate-pulse" />
        )}
      </div>

      {/* Basic fields */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">Tytuł / nota oferty</label>
          {aiBusy === "fill" ? (
            <Skel />
          ) : (
            <input
              className={`input${fc(form.title)}`}
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          )}
        </div>
        <div>
          <label className="label">SKU oferty (id_offer)</label>
          <input
            className={`input${fc(form.sku)}`}
            value={form.sku}
            onChange={(e) => set({ sku: e.target.value })}
          />
        </div>
        <div>
          <label className="label">
            EAN <span className="text-red-500">*</span>
          </label>
          <input
            className={`input${fc(form.ean)}`}
            value={form.ean}
            onChange={(e) => set({ ean: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Cena (zł)</label>
          <input
            type="number"
            step="0.01"
            className="input"
            value={form.price}
            onChange={(e) => set({ price: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <label className="label">Cena minimalna (zł, opcjonalnie)</label>
          <input
            type="number"
            step="0.01"
            className="input"
            value={form.minimum_price}
            onChange={(e) =>
              set({
                minimum_price:
                  e.target.value === "" ? "" : parseFloat(e.target.value),
              })
            }
          />
        </div>
        <div>
          <label className="label">Ilość</label>
          <input
            type="number"
            className="input"
            value={form.quantity}
            onChange={(e) => set({ quantity: parseInt(e.target.value) || 0 })}
          />
        </div>
        <div>
          <label className="label">Stan</label>
          <select
            className="input"
            value={form.condition}
            onChange={(e) => set({ condition: e.target.value })}
          >
            <option value="NEW">Nowy</option>
            <option value="USED">Używany</option>
          </select>
        </div>
        <div>
          <label className="label">Czas przygotowania (dni)</label>
          <input
            type="number"
            min={0}
            className="input"
            value={form.handling_time}
            onChange={(e) =>
              set({ handling_time: parseInt(e.target.value) || 0 })
            }
          />
        </div>
        <div>
          <label className="label">Grupa wysyłki</label>
          {loadingOpts ? (
            <Skel />
          ) : (
            <select
              className={`input${fc(form.id_shipping_group)}`}
              value={form.id_shipping_group}
              onChange={(e) =>
                set({
                  id_shipping_group:
                    e.target.value === "" ? "" : parseInt(e.target.value),
                })
              }
            >
              <option value="">—</option>
              {shippingGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.isDefault ? " (domyślna)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className="label">Magazyn</label>
          {loadingOpts ? (
            <Skel />
          ) : (
            <select
              className={`input${fc(form.id_warehouse)}`}
              value={form.id_warehouse}
              onChange={(e) =>
                set({
                  id_warehouse:
                    e.target.value === "" ? "" : parseInt(e.target.value),
                })
              }
            >
              <option value="">—</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.isDefault ? " (domyślny)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Description + Images — sent to Kaufland Product data catalog */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-gray-500 uppercase">
          Opis i zdjęcia (Product data)
        </h4>
        <div>
          <label className="label">
            Opis{" "}
            <span className="text-gray-400 font-normal">
              (HTML, do 65 000 znaków)
            </span>
          </label>
          <textarea
            className={`input min-h-[90px]${form.description ? " is-filled" : ""}`}
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Opis produktu widoczny na Kaufland.pl…"
          />
        </div>
        <div>
          <label className="label">
            Krótki opis{" "}
            <span className="text-gray-400 font-normal">
              (bez HTML, do 1 024 znaków)
            </span>
          </label>
          <textarea
            className={`input min-h-[60px]${form.short_description ? " is-filled" : ""}`}
            value={form.short_description}
            onChange={(e) => set({ short_description: e.target.value })}
            placeholder="Krótkie podsumowanie najważniejszych cech produktu…"
          />
        </div>
        <div>
          <label className="label">
            Zdjęcia{" "}
            <span className="text-gray-400 font-normal">
              (URL każdego w osobnej linii)
            </span>
          </label>
          <textarea
            className={`input min-h-[80px] font-mono text-xs${form.images.length ? " is-filled" : ""}`}
            value={form.images.join("\n")}
            onChange={(e) =>
              set({
                images: e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="https://example.com/image1.jpg&#10;https://example.com/image2.jpg"
          />
          {form.images.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {form.images.slice(0, 8).map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={url}
                  alt=""
                  className="w-14 h-14 object-contain rounded border border-gray-200 bg-gray-50"
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Category picker */}
      <div className="space-y-2">
        <label className="label">Kategoria {MP_NAME}</label>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            value={phrase}
            placeholder="Szukaj kategorii…"
            onChange={(e) => setPhrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                searchCategories();
              }
            }}
          />
          <button className="btn-secondary btn-sm" onClick={searchCategories}>
            Szukaj
          </button>
        </div>
        {form.categoryCode && (
          <p className="text-xs text-green-700">
            Wybrano: {form.categoryLabel}{" "}
            <span className="font-mono text-gray-400">
              ({form.categoryCode})
            </span>
          </p>
        )}
        {categories.length > 0 && (
          <ul className="border border-gray-200 rounded-lg divide-y max-h-48 overflow-auto">
            {categories.map((c) => (
              <li key={c.code}>
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-green-50"
                  onClick={() => selectCategory(c)}
                >
                  {c.label}{" "}
                  <span className="font-mono text-xs text-gray-400">
                    {c.code}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Product attributes (Kaufland „Product data" — stored in draft; fill in Seller Center for catalog update) */}
      {kAttributes.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-semibold text-gray-500 uppercase">
              Atrybuty produktu
            </h4>
            <span className="text-xs text-gray-400">
              (zapisywane w szkicu; edytuj też w Kaufland Seller Center →
              Product data)
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {kAttributes.map((a) => (
              <div key={a.code}>
                <label className="label">{a.label}</label>
                <input
                  className={`input${(form.attributes[a.code] ?? "") ? " is-filled" : ""}`}
                  value={(form.attributes[a.code] as string) || ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      attributes: { ...f.attributes, [a.code]: e.target.value },
                    }))
                  }
                  placeholder={
                    a.type === "SI_M"
                      ? "np. 50 cm"
                      : a.type === "SI_KG"
                        ? "np. 15 kg"
                        : ""
                  }
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {status?.startsWith("success:") &&
        (() => {
          const ref = status.slice("success:".length);
          const portalUrl = `https://sellerportal.kaufland.de/product-data/${encodeURIComponent(form.ean)}/attributes?unitId=${ref}&storefront=pl`;
          return (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-green-800">
                  Oferta wystawiona na Kaufland
                </p>
                <p className="text-xs text-green-700 mt-0.5">
                  Unit ID: <span className="font-mono">{ref}</span> · EAN:{" "}
                  {form.ean}
                </p>
              </div>
              <a
                href={portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 btn-sm px-3 font-semibold text-white bg-green-600 hover:bg-green-700 rounded-md text-xs"
              >
                Przejdź do produktu Kaufland →
              </a>
            </div>
          );
        })()}

      {(pdStatus || form.ean) && (
        <div
          className={`rounded-lg border px-4 py-3 ${
            !pdStatus
              ? "bg-gray-50 border-gray-200"
              : pdStatus.ready && pdStatus.pictures.rejected === 0
                ? "bg-green-50 border-green-200"
                : "bg-amber-50 border-amber-200"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-gray-800">
              Dane produktowe Kaufland
              {pdStatus && (
                <span className="ml-2 font-normal text-gray-500">
                  {pdStatus.ready ? "kompletne" : "niekompletne"} ·{" "}
                  {pdStatus.status}
                </span>
              )}
            </p>
            <button
              className="btn-secondary btn-sm text-xs shrink-0"
              onClick={checkProductData}
              disabled={pdBusy || !form.ean}
            >
              {pdBusy ? "Sprawdzam…" : "Sprawdź w Kauflandzie"}
            </button>
          </div>

          {pdStatus && (
            <ul className="text-xs text-gray-700 mt-2 space-y-1">
              {pdStatus.status === "NONE" && (
                <li>
                  Dla tego EAN-u nie wysłano jeszcze żadnych danych
                  produktowych.
                </li>
              )}
              {pdStatus.missing.length > 0 && (
                <li>
                  <b>Brakuje:</b> {pdStatus.missing.join(", ")}
                </li>
              )}
              {pdStatus.blocked.length > 0 && (
                <li className="text-red-700">
                  <b>Zablokowany:</b> {pdStatus.blocked.join(", ")}
                </li>
              )}
              {pdStatus.failReason && (
                <li className="text-red-700">
                  <b>Odrzucone:</b> {pdStatus.failReason}
                </li>
              )}
              <li>
                <b>Zdjęcia:</b>{" "}
                {pdStatus.pictures.total === 0
                  ? "brak — Kaufland nie przyjął żadnego"
                  : `${pdStatus.pictures.total - pdStatus.pictures.rejected} z ${pdStatus.pictures.total} przyjętych`}
              </li>
              <li>
                <b>GPSR:</b>{" "}
                {pdStatus.gpsr
                  ? "kontakt ustawiony"
                  : "brak kontaktu — trzeba będzie wpisać ręcznie"}
              </li>
              {pdStatus.declined.slice(0, 4).map((d, i) => (
                <li key={i} className="text-amber-800">
                  {d.attribute}: {d.state}
                  {d.message ? ` — ${d.message}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {status && !status.startsWith("success:") && (
        <div className="text-sm rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-gray-700">
          {status}
        </div>
      )}

      {unitId && (
        <div className="flex items-center gap-2 text-xs text-gray-500 pt-1">
          <span className="font-mono text-gray-400">unit {unitId}</span>
          {unitMeta && (
            <span
              className={
                unitMeta.isLive === false ? "text-amber-700" : "text-gray-500"
              }
            >
              {unitMeta.status || "—"}
              {unitMeta.isLive === false
                ? " · niewidoczna na Kaufland.pl"
                : unitMeta.isLive
                  ? " · widoczna"
                  : ""}
            </span>
          )}
          <a
            href={`https://sellerportal.kaufland.de/product-data/${encodeURIComponent(form.ean)}/attributes?unitId=${unitId}&storefront=pl`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-green-600 hover:underline font-medium"
          >
            → Kaufland Product data
          </a>
        </div>
      )}

      <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-gray-100">
        <button
          className="btn-secondary btn-sm text-red-600 hover:bg-red-50 mr-auto"
          onClick={handleWithdraw}
          disabled={busy || !unitId}
        >
          Wycofaj z {MP_NAME}
        </button>
        <button
          className="btn-secondary btn-sm"
          onClick={handleSaveDraft}
          disabled={busy}
        >
          Zapisz szkic
        </button>
        <button
          className="btn-sm px-3 font-semibold text-white bg-green-600 hover:bg-green-700 rounded-md disabled:opacity-50"
          onClick={handlePublish}
          disabled={busy}
        >
          {busy ? "…" : `Wystaw na ${MP_NAME}`}
        </button>
      </div>
    </div>
  );
}
