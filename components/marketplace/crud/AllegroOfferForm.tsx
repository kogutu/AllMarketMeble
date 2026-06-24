'use client';

/**
 * Allegro — samodzielny CRUD oferty. Komponuje dedykowany (już odizolowany) formularz Allegro
 * components/offers/AllegroForm.tsx i dokłada panel „Wycofaj z Allegro" (zakończenie ofert).
 * AllegroForm jest plikiem wyłącznie Allegro — jego edycja nie wpływa na Empik/BRW/Kaufland.
 */

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import type { TyreProduct } from '@/types';
import AllegroForm from '@/components/offers/AllegroForm';

interface AccountOffer { account_id: string; allegro_offer_id: string | null; status: string; }

export default function AllegroOfferForm({
  product, accountPrices, onPublished,
}: { product: TyreProduct; accountPrices?: Record<string, number>; onPublished?: () => void }) {
  const [published, setPublished] = useState<AccountOffer[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const loadPublished = useCallback(() => {
    fetch(`/api/offers?typesense_id=${encodeURIComponent(String(product.id))}`)
      .then((r) => r.json())
      .then((d) => setPublished(((d.accountOffers || []) as AccountOffer[]).filter((a) => a.allegro_offer_id)))
      .catch(() => {});
  }, [product.id]);

  useEffect(() => { loadPublished(); }, [loadPublished]);

  const handleWithdraw = async (acc: AccountOffer) => {
    if (!acc.allegro_offer_id) return;
    if (!confirm(`Wycofać ofertę Allegro #${acc.allegro_offer_id} (konto ${acc.account_id})?`)) return;
    setBusy(acc.account_id);
    try {
      const res = await fetch('/api/marketplace/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'allegro', ref: acc.allegro_offer_id, accountId: acc.account_id }),
      });
      const d = await res.json();
      if (res.ok && d.success) { toast.success('Wycofano z Allegro'); loadPublished(); }
      else toast.error('Błąd wycofania: ' + (d.details || d.error || ''));
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <AllegroForm product={product} accountPrices={accountPrices} onPublished={() => { onPublished?.(); loadPublished(); }} />

      {published.length > 0 && (
        <div className="card p-4 space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Wycofaj z Allegro</h3>
          <div className="flex flex-wrap gap-2">
            {published.map((acc) => (
              <button
                key={acc.account_id}
                onClick={() => handleWithdraw(acc)}
                disabled={busy !== null}
                className="btn-sm px-3 py-1.5 rounded-md text-xs font-semibold border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
                title={`Allegro #${acc.allegro_offer_id} — ${acc.status}`}
              >
                {busy === acc.account_id ? 'Wycofuję…' : `Wycofaj ${acc.account_id} (#${acc.allegro_offer_id})`}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
