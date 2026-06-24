'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TyreProduct } from '@/types';
import AllegroOfferForm from '@/components/marketplace/crud/AllegroOfferForm';
import AccountPanels from '@/components/products/AccountPanels';
import { MarginRule, matchMargin, applyMargin } from '@/lib/margins';
import { PriceOverride } from '@/app/api/prices/route';

interface AllegroAccount {
  account_id: string;
  account_name: string;
}

// ─── Prices block ─────────────────────────────────────────────────────────────

function PricingBlock({
  product,
  accounts,
  marginRules,
  overrides,
  onSave,
  onClear,
}: {
  product: TyreProduct;
  accounts: AllegroAccount[];
  marginRules: MarginRule[];
  overrides: PriceOverride[];
  onSave: (accountId: string, price: number) => Promise<void>;
  onClear: (accountId: string) => Promise<void>;
}) {
  const base = product.price_gross || 0;

  return (
    <div className="card p-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Ceny</h3>
      <div className="flex flex-wrap gap-3">
        {/* Base price */}
        <div className="flex-1 min-w-[130px] bg-gray-50 rounded-lg px-4 py-3 border border-gray-200">
          <p className="text-xs text-gray-400 mb-1">Sklep (bazowa)</p>
          <p className="text-xl font-bold text-gray-800">{base.toFixed(2)} zł</p>
        </div>

        {/* Per-account prices */}
        {accounts.map((acc) => (
          <AccountPriceCard
            key={acc.account_id}
            account={acc}
            base={base}
            product={product}
            marginRules={marginRules}
            override={overrides.find((o) => o.account_id === acc.account_id) ?? null}
            onSave={(p) => onSave(acc.account_id, p)}
            onClear={() => onClear(acc.account_id)}
          />
        ))}

        {accounts.length === 0 && (
          <p className="text-xs text-gray-400 italic self-center">Brak kont Allegro</p>
        )}
      </div>
    </div>
  );
}

function AccountPriceCard({
  account,
  base,
  product,
  marginRules,
  override,
  onSave,
  onClear,
}: {
  account: AllegroAccount;
  base: number;
  product: TyreProduct;
  marginRules: MarginRule[];
  override: PriceOverride | null;
  onSave: (price: number) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [saving, setSaving] = useState(false);

  const rule = matchMargin(marginRules, { kind: product.kind }, account.account_id);
  const marginPct = rule ? Number(rule.margin_pct) : 0;
  const computed = applyMargin(base, marginPct);
  const price = override ? Number(override.price) : computed;
  const isOverride = !!override;
  const diff = price - base;

  const handleEdit = () => { setInputVal(price.toFixed(2)); setEditing(true); };
  const handleSave = async () => {
    const p = parseFloat(inputVal);
    if (isNaN(p) || p <= 0) return;
    setSaving(true);
    await onSave(p);
    setSaving(false);
    setEditing(false);
  };
  const handleClear = async () => { setSaving(true); await onClear(); setSaving(false); };
  const handleKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); };

  return (
    <div className="flex-1 min-w-[160px] bg-indigo-50 rounded-lg px-4 py-3 border border-indigo-100 space-y-2">
      <p className="text-xs text-gray-600 font-semibold truncate">{account.account_name}</p>

      {editing ? (
        <div className="space-y-1.5">
          <input
            type="number" step="0.01" min="0"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKey}
            className="input text-sm py-1 w-full"
            autoFocus
          />
          <div className="flex gap-1">
            <button onClick={handleSave} disabled={saving}
              className="btn-primary btn-sm text-xs flex-1">{saving ? '…' : 'Zapisz'}</button>
            <button onClick={() => setEditing(false)}
              className="btn-secondary btn-sm text-xs flex-1">Anuluj</button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xl font-bold text-gray-900">{price.toFixed(2)} zł</p>
          <p className="text-xs">
            {isOverride ? (
              <span className="text-amber-600">ręcznie (+{diff.toFixed(2)} zł)</span>
            ) : marginPct > 0 ? (
              <span className="text-indigo-600">+{marginPct.toFixed(1)}% &nbsp;(+{diff.toFixed(2)} zł)</span>
            ) : (
              <span className="text-gray-400">brak marży</span>
            )}
          </p>
          <div className="flex gap-2">
            <button onClick={handleEdit}
              className="text-xs text-gray-400 hover:text-gray-700">Edytuj</button>
            {isOverride && (
              <button onClick={handleClear} disabled={saving}
                className="text-xs text-red-400 hover:text-red-600">Reset</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AddToAllegroPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [product, setProduct] = useState<TyreProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AllegroAccount[]>([]);
  const [marginRules, setMarginRules] = useState<MarginRule[]>([]);
  const [overrides, setOverrides] = useState<PriceOverride[]>([]);
  const [publishCount, setPublishCount] = useState(0);

  useEffect(() => {
    fetch(`/api/products/${params.id}`)
      .then((r) => { if (!r.ok) throw new Error('Produkt nie znaleziony'); return r.json(); })
      .then(setProduct)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));

    fetch('/api/allegro/accounts').then((r) => r.json()).then((d) => setAccounts(d.accounts || [])).catch(() => {});
    fetch('/api/margins').then((r) => r.json()).then((d) => setMarginRules(d.rules || [])).catch(() => {});
  }, [params.id]);

  useEffect(() => {
    if (!params.id) return;
    fetch(`/api/prices?typesense_ids=${encodeURIComponent(params.id)}`)
      .then((r) => r.json())
      .then((d) => setOverrides(d.overrides || []))
      .catch(() => {});
  }, [params.id]);

  const saveOverride = async (accountId: string, price: number) => {
    await fetch('/api/prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typesense_id: params.id, account_id: accountId, price }),
    });
    setOverrides((prev) => {
      const without = prev.filter((o) => o.account_id !== accountId);
      return [...without, { id: 0, typesense_id: params.id, account_id: accountId, price } as PriceOverride];
    });
  };

  const clearOverride = async (accountId: string) => {
    await fetch(`/api/prices?typesense_id=${encodeURIComponent(params.id)}&account_id=${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    setOverrides((prev) => prev.filter((o) => o.account_id !== accountId));
  };

  // Compute per-account prices (used by AllegroForm to set correct price on publish)
  const accountPrices: Record<string, number> = {};
  if (product) {
    const base = product.price_gross || 0;
    for (const acc of accounts) {
      const override = overrides.find((o) => o.account_id === acc.account_id);
      if (override) {
        accountPrices[acc.account_id] = Number(override.price);
      } else {
        const rule = matchMargin(marginRules, { kind: product.kind }, acc.account_id);
        const pct = rule ? Number(rule.margin_pct) : 0;
        accountPrices[acc.account_id] = applyMargin(base, pct);
      }
    }
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="card p-8 animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-100 rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="card p-8 text-center">
          <p className="text-red-600 font-medium">{error || 'Nie znaleziono produktu'}</p>
          <button onClick={() => router.push('/products')} className="btn-secondary mt-4">
            ← Wróć do listy
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500 flex items-center gap-1">
        <button onClick={() => router.push('/products')} className="hover:text-gray-700">
          Produkty
        </button>
        <span>/</span>
        <span className="text-gray-900 font-medium truncate max-w-xs">
          {product.name}
        </span>
        <span>/</span>
        <span className="text-allegro font-medium">Dodaj do Allegro</span>
      </nav>

      {/* Prices block */}
      <PricingBlock
        product={product}
        accounts={accounts}
        marginRules={marginRules}
        overrides={overrides}
        onSave={saveOverride}
        onClear={clearOverride}
      />

      {/* Account / offer status panels */}
      <AccountPanels
        product={product}
        accounts={accounts}
        marginRules={marginRules}
        initialOverrides={overrides}
        refreshTrigger={publishCount}
      />

      <AllegroOfferForm
        product={product}
        accountPrices={accountPrices}
        onPublished={() => setPublishCount((n) => n + 1)}
      />
    </div>
  );
}
