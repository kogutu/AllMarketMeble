'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { TyreProduct } from '@/types';
import { MarginRule, matchMargin, applyMargin } from '@/lib/margins';
import { PriceOverride } from '@/app/api/prices/route';

interface AccountDef {
  account_id: string;
  account_name: string;
}

interface AccountOffer {
  account_id: string;
  allegro_offer_id: string | null;
  status: string;
  allegro_title: string | null;
  published_at: string | null;
  last_sync: string | null;
}

interface Props {
  product: TyreProduct;
  accounts: AccountDef[];
  marginRules: MarginRule[];
  initialOverrides: PriceOverride[];
  refreshTrigger?: number;
}

const ALLEGRO_BASE =
  typeof window !== 'undefined' ? '' : ''; // always relative

function computePrice(
  basePrice: number,
  accountId: string,
  rules: MarginRule[],
  overrides: PriceOverride[],
  product: TyreProduct
): { price: number; isOverride: boolean; marginPct: number } {
  const override = overrides.find((o) => o.account_id === accountId);
  if (override) return { price: Number(override.price), isOverride: true, marginPct: 0 };
  const rule = matchMargin(rules, { kind: product.kind }, accountId);
  if (rule) {
    const pct = Number(rule.margin_pct);
    return { price: applyMargin(basePrice, pct), isOverride: false, marginPct: pct };
  }
  return { price: basePrice, isOverride: false, marginPct: 0 };
}

function statusBadge(status: string) {
  const s = status.toUpperCase();
  if (s === 'ACTIVE') return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium">● Aktywna</span>;
  if (s === 'INACTIVE') return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">● Nieaktywna</span>;
  if (s === 'ENDED') return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-medium">● Zakończona</span>;
  if (s === 'PENDING') return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 font-medium">● Oczekuje</span>;
  return <span className="text-xs text-gray-400 font-mono">{status}</span>;
}

const ALLEGRO_ENV = process.env.NEXT_PUBLIC_ALLEGRO_ENV ?? 'production';
function allegroEditUrl(id: string) {
  const base = ALLEGRO_ENV === 'sandbox' ? 'https://salescenter.allegro.com.allegrosandbox.pl' : 'https://salescenter.allegro.com';
  return `${base}/offer/${id}/restore`;
}
function allegroViewUrl(id: string) {
  const base = ALLEGRO_ENV === 'sandbox' ? 'https://allegro.pl.allegrosandbox.pl' : 'https://allegro.pl';
  return `${base}/oferta/${id}`;
}

const POLL_INTERVAL_MS = 4000;
const POLL_MAX_COUNT = 6; // ~24s total

export default function AccountPanels({ product, accounts, marginRules, initialOverrides, refreshTrigger }: Props) {
  const [overrides, setOverrides] = useState<PriceOverride[]>(initialOverrides);
  const [accountOffers, setAccountOffers] = useState<AccountOffer[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [polling, setPolling] = useState(false);
  const [chceker, setChecker] = useState(true);
  const [chcekerTime, setCheckerTime] = useState(0);
  const pollCountRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const basePrice = product.price_gross || 0;


  const loadOffers = useCallback((sync = false, quiet = false) => {
    if (!quiet) setSyncing(true);
    console.log("WWWWW_---");

    fetch(`/api/allegro/offer-accounts?typesense_id=${encodeURIComponent(product.id)}${sync ? '&sync=1' : ''}`)
      .then((r) => r.json())
      .then((d) => setAccountOffers(d.accounts || []))
      .catch(() => { })
      .finally(() => { if (!quiet) setSyncing(false); });
  }, [product.id]);

  useEffect(() => {
    loadOffers();

    let intervalId: ReturnType<typeof setInterval> | null = null;
    console.log("Chce");
    console.log(chceker);


    if (chceker) {
      console.log(chceker);

      // const offersInterval = setInterval(() => {
      //   console.log("wwwkl");
      //   console.log(chceker);

      //   loadOffers();
      // }, 30000);

      intervalId = setInterval(() => {
        setCheckerTime(prevTime => {

          if (prevTime === 0) {
            console.log("setCheckerTime");
            loadOffers(true, true);
            return 90;
          }
          return prevTime - 1;
        });
      }, 1000);

      return () => {
        // clearInterval(offersInterval);
        if (intervalId) clearInterval(intervalId);
      };
    }
  }, [loadOffers, chceker]); // <--- KLUCZOWA ZMIANA
  // On publish: immediate fetch + start polling
  useEffect(() => {
    if (!refreshTrigger) return;
    pollCountRef.current = 0;
    setPolling(true);
    loadOffers(false, true);

    const tick = () => {
      pollCountRef.current += 1;
      loadOffers(false, true);
      if (pollCountRef.current >= POLL_MAX_COUNT) {
        setPolling(false);
      } else {
        pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
      }
    };
    pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  const saveOverride = async (accountId: string, price: number) => {
    await fetch('/api/prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typesense_id: product.id, account_id: accountId, price }),
    });
    setOverrides((prev) => {
      const without = prev.filter((o) => o.account_id !== accountId);
      return [...without, { id: 0, typesense_id: product.id, account_id: accountId, price } as PriceOverride];
    });
  };

  const clearOverride = async (accountId: string) => {
    await fetch(`/api/prices?typesense_id=${encodeURIComponent(product.id)}&account_id=${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    setOverrides((prev) => prev.filter((o) => o.account_id !== accountId));
  };

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">Konta / Marże</h3>
          {polling && (
            <span className="flex items-center gap-1 text-xs text-indigo-500 font-medium">
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Oczekiwanie na Allegro…
            </span>
          )}
        </div>
        <button
          onClick={() => loadOffers(true)}
          disabled={syncing || polling}
          className="text-xs text-gray-400 hover:text-allegro disabled:opacity-50"
          title="Odśwież statusy z Allegro"
        >
          {syncing ? 'Synchronizacja...' : '↻ Odśwież statusy'}
          &nbsp; [autoodswieżanie za: {chcekerTime} s ]
        </button>
      </div>

      {/* Sklep row */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-4">
        <div className="w-28 shrink-0">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">SKLEP</p>
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-gray-900">{basePrice.toFixed(2)} zł</p>
          <p className="text-xs text-gray-400">Cena zakupu</p>
        </div>
      </div>

      {/* Per-account rows */}
      {accounts.map((acc) => {
        const priceInfo = computePrice(basePrice, acc.account_id, marginRules, overrides, product);
        const offer = accountOffers.find((o) => o.account_id === acc.account_id);
        return (
          <AccountRow
            key={acc.account_id}
            account={acc}
            priceInfo={priceInfo}
            offer={offer ?? null}
            onSavePrice={(p) => saveOverride(acc.account_id, p)}
            onClearPrice={() => clearOverride(acc.account_id)}
          />
        );
      })}

      {accounts.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-gray-400">
          Brak kont Allegro. <a href="/accounts" className="text-allegro hover:underline">Dodaj konto →</a>
        </div>
      )}
    </div>
  );
}

interface RowProps {
  account: AccountDef;
  priceInfo: { price: number; isOverride: boolean; marginPct: number };
  offer: AccountOffer | null;
  onSavePrice: (p: number) => Promise<void>;
  onClearPrice: () => Promise<void>;
}

function AccountRow({ account, priceInfo, offer, onSavePrice, onClearPrice }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [saving, setSaving] = useState(false);

  const handleEdit = () => { setInputVal(priceInfo.price.toFixed(2)); setEditing(true); };
  const handleSave = async () => {
    const p = parseFloat(inputVal);
    if (isNaN(p) || p <= 0) return;
    setSaving(true);
    await onSavePrice(p);
    setSaving(false);
    setEditing(false);
  };
  const handleClear = async () => { setSaving(true); await onClearPrice(); setSaving(false); };

  return (
    <div className="px-4 py-3 border-b border-gray-100 last:border-0">
      <div className="flex items-start gap-4">
        {/* Account label */}
        <div className="w-28 shrink-0 pt-0.5">
          <p className="text-xs font-semibold text-gray-700 truncate">{account.account_name}</p>
          <p className="text-xs text-gray-400 font-mono truncate">{account.account_id}</p>
        </div>

        {/* Price */}
        <div className="w-36 shrink-0">
          {editing ? (
            <div className="space-y-1.5">
              <input
                type="number" step="0.01" min="0"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                className="input text-sm w-full py-1"
                autoFocus
              />
              <div className="flex gap-1">
                <button onClick={handleSave} disabled={saving} className="btn-primary btn-sm text-xs flex-1">
                  {saving ? '...' : 'Zapisz'}
                </button>
                <button onClick={() => setEditing(false)} className="btn-secondary btn-sm text-xs flex-1">Anuluj</button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm font-bold text-gray-900">{priceInfo.price.toFixed(2)} zł</p>
              {priceInfo.isOverride ? (
                <p className="text-xs text-amber-600">Ręcznie</p>
              ) : priceInfo.marginPct > 0 ? (
                <p className="text-xs text-green-600">+{priceInfo.marginPct.toFixed(1)}%</p>
              ) : (
                <p className="text-xs text-gray-400">Baza</p>
              )}
              <div className="flex gap-1 mt-1">
                <button onClick={handleEdit} className="text-xs text-gray-400 hover:text-gray-700">Edytuj</button>
                {priceInfo.isOverride && (
                  <button onClick={handleClear} disabled={saving} className="text-xs text-red-400 hover:text-red-600">Reset</button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Offer status */}
        <div className="flex-1 min-w-0">
          {offer?.allegro_offer_id ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                {statusBadge(offer.status)}
                <span className="text-xs text-gray-400 font-mono">#{offer.allegro_offer_id}</span>
              </div>
              {offer.allegro_title && (
                <p className="text-xs text-gray-600 truncate" title={offer.allegro_title}>{offer.allegro_title}</p>
              )}
              <div className="flex gap-3 mt-1">
                <a
                  href={allegroEditUrl(offer.allegro_offer_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-allegro hover:underline"
                >
                  ✎ Edytuj na Allegro
                </a>
                <a
                  href={allegroViewUrl(offer.allegro_offer_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-gray-400 hover:text-gray-700 hover:underline"
                >
                  ↗ Zobacz aukcję
                </a>
              </div>
              {offer.last_sync && (
                <p className="text-xs text-gray-300">
                  sync: {new Date(offer.last_sync).toLocaleString('pl')}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">Nie wystawiono</p>
          )}
        </div>
      </div>
    </div>
  );
}
