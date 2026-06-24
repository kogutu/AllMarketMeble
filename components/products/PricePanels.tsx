'use client';

import { useState } from 'react';
import { TyreProduct } from '@/types';
import { MarginRule, matchMargin, applyMargin } from '@/lib/margins';
import { PriceOverride } from '@/app/api/prices/route';

interface AccountDef {
  account_id: string;
  account_name: string;
}

interface Props {
  product: TyreProduct;
  accounts: AccountDef[];
  marginRules: MarginRule[];
  initialOverrides: PriceOverride[];
}

function computePrice(
  basePrice: number,
  accountId: string,
  rules: MarginRule[],
  overrides: PriceOverride[],
  product: TyreProduct
): { price: number; isOverride: boolean; marginPct: number } {
  const override = overrides.find((o) => o.account_id === accountId);
  if (override) {
    return { price: Number(override.price), isOverride: true, marginPct: 0 };
  }
  const rule = matchMargin(rules, { kind: product.kind }, accountId);
  if (rule) {
    const pct = Number(rule.margin_pct);
    return { price: applyMargin(basePrice, pct), isOverride: false, marginPct: pct };
  }
  return { price: basePrice, isOverride: false, marginPct: 0 };
}

interface PanelProps {
  label: string;
  price: number;
  isOverride: boolean;
  marginPct: number;
  editable: boolean;
  onSave?: (price: number) => Promise<void>;
  onClear?: () => Promise<void>;
}

function PricePanel({ label, price, isOverride, marginPct, editable, onSave, onClear }: PanelProps) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [saving, setSaving] = useState(false);

  const handleEdit = () => {
    setInputVal(price.toFixed(2));
    setEditing(true);
  };

  const handleSave = async () => {
    const p = parseFloat(inputVal);
    if (isNaN(p) || p <= 0) return;
    setSaving(true);
    await onSave?.(p);
    setSaving(false);
    setEditing(false);
  };

  const handleClear = async () => {
    setSaving(true);
    await onClear?.();
    setSaving(false);
  };

  return (
    <div className="flex-1 min-w-0 border border-gray-200 rounded-lg p-3 bg-white">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{label}</div>
      {editing ? (
        <div className="space-y-2">
          <input
            type="number"
            step="0.01"
            min="0"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            className="input text-sm w-full"
            autoFocus
          />
          <div className="flex gap-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary btn-sm text-xs flex-1"
            >
              {saving ? '...' : 'Zapisz'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="btn-secondary btn-sm text-xs flex-1"
            >
              Anuluj
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="text-lg font-bold text-gray-900">{price.toFixed(2)} zł</div>
          {isOverride ? (
            <div className="text-xs text-amber-600 font-medium mt-0.5">Ręcznie ustawiona</div>
          ) : marginPct > 0 ? (
            <div className="text-xs text-green-600 mt-0.5">+{marginPct.toFixed(1)}%</div>
          ) : (
            <div className="text-xs text-gray-400 mt-0.5">Cena bazowa</div>
          )}
          {editable && (
            <div className="flex gap-1 mt-2">
              <button onClick={handleEdit} className="btn-secondary btn-sm text-xs flex-1">
                Edytuj
              </button>
              {isOverride && (
                <button
                  onClick={handleClear}
                  disabled={saving}
                  className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50"
                >
                  {saving ? '...' : 'Reset'}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function PricePanels({ product, accounts, marginRules, initialOverrides }: Props) {
  const [overrides, setOverrides] = useState<PriceOverride[]>(initialOverrides);
  const basePrice = product.price_gross || 0;

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
    await fetch(`/api/prices?typesense_id=${encodeURIComponent(product.id)}&account_id=${encodeURIComponent(accountId)}`, {
      method: 'DELETE',
    });
    setOverrides((prev) => prev.filter((o) => o.account_id !== accountId));
  };

  const sklepInfo = { price: basePrice, isOverride: false, marginPct: 0 };

  return (
    <div className="card p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Ceny</h3>
      <div className="flex gap-3">
        {/* SKLEP — base price, read-only */}
        <PricePanel
          label="SKLEP"
          price={sklepInfo.price}
          isOverride={false}
          marginPct={0}
          editable={false}
        />

        {/* Per-account panels */}
        {accounts.map((acc) => {
          const info = computePrice(basePrice, acc.account_id, marginRules, overrides, product);
          return (
            <PricePanel
              key={acc.account_id}
              label={acc.account_name}
              price={info.price}
              isOverride={info.isOverride}
              marginPct={info.marginPct}
              editable
              onSave={(p) => saveOverride(acc.account_id, p)}
              onClear={() => clearOverride(acc.account_id)}
            />
          );
        })}
      </div>
    </div>
  );
}
