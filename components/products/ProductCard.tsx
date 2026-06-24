'use client';

import Image from 'next/image';
import { MebleProduct } from '@/types';
import clsx from 'clsx';
import { listMarketplaces, ACCENT_CLASSES } from '@/lib/marketplaces/catalog';

interface AccountPrice {
  id: string;
  name: string;
  price: number | null;
}

type LiveStatus = { listed: boolean; active: boolean };

interface Props {
  product: MebleProduct;
  onAddToAllegro: (product: MebleProduct) => void;
  onAddToMirakl: (product: MebleProduct) => void;
  /** Optional: route to a dedicated CRUD per marketplace slug (allegro|empik|brw|kaufland). */
  onAddToMarketplace?: (slug: string, product: MebleProduct) => void;
  priceAllegro?: AccountPrice[];
  offerStatus: Record<string, { o: string; s: number }>;
  hasDraft?: boolean;
  statuses?: Record<string, LiveStatus>; // slug → status
}

function ListedBadge({ label, name, state }: { label: string; name: string; state: 'active' | 'listed' | 'none' }) {
  const cls = state === 'active' ? 'bg-green-500 text-white'
    : state === 'listed' ? 'bg-yellow-400 text-white' : 'bg-gray-200 text-gray-400';
  return <span title={`${name}: ${state === 'active' ? 'aktywne' : state === 'listed' ? 'wystawione' : 'nie wystawione'}`}
    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cls}`}>{label}</span>;
}

export default function ProductCard({ product, onAddToAllegro, onAddToMirakl, onAddToMarketplace, priceAllegro = [], offerStatus, hasDraft = false, statuses }: Props) {
  const stateFor = (slug: string): 'active' | 'listed' | 'none' => {
    const s = statuses?.[slug];
    if (s?.active) return 'active';
    if (s?.listed) return 'listed';
    // Fallback for Allegro from per-account offerStatus when DB not synced yet.
    if (slug === 'allegro') {
      if (Object.values(offerStatus).some((o) => o.s === 1)) return 'active';
      if (Object.keys(offerStatus).length > 0) return 'listed';
    }
    return 'none';
  };
  const image = product.img || product.extra_json?.image || product.gallery_images?.[0];
  const offerQty = product.qty ?? 0;
  const basePrice = product.price_gross || 0;
  const regular = product.regularprice || 0;
  const isPromo = !!product.ispromo && regular > basePrice;
  const kolor = product.color?.name || product.attrs?.['kolor'];

  return (
    <div className="card flex flex-col hover:border-allegro/30 transition-colors">
      {/* Image */}
      <div className="relative h-40 bg-gray-50 rounded-t-xl overflow-hidden">
        {image ? (
          <Image
            src={image}
            alt={product.name}
            fill
            className="object-contain p-2"
            sizes="(max-width: 768px) 100vw, 25vw"
            unoptimized
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-300">
            <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
        )}

        {/* Badges */}
        <div className="absolute top-2 left-2 flex gap-1 flex-wrap">
          {hasDraft && (
            <span title="Zapisany szkic oferty (draft)"
              className="badge text-xs bg-allegro text-white flex items-center gap-1 animate-pulse">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Szkic
            </span>
          )}
          {isPromo && <span className="badge bg-red-100 text-red-700 text-xs">Promocja</span>}
          {product.is_set && <span className="badge bg-indigo-100 text-indigo-700 text-xs">Zestaw</span>}
        </div>

        {/* Listed-on badges (per marketplace) */}
        <div className="absolute top-2 right-2 flex gap-1">
          {listMarketplaces().map((m) => (
            <ListedBadge key={m.slug} label={m.badge} name={m.name} state={stateFor(m.slug)} />
          ))}
        </div>

        {/* Per-account status dots */}
        {priceAllegro.length > 0 && (
          <div className="absolute bottom-2 right-2 flex gap-1">
            {priceAllegro.map((acc) => {
              const st = offerStatus[acc.id];
              const active = st?.s === 1;
              const published = !!st;
              return (
                <span key={acc.id}
                  title={`${acc.name}: ${active ? 'Aktywna' : published ? 'Nieaktywna/zakończona' : 'Nie dodano'}`}
                  className={clsx('w-2.5 h-2.5 rounded-full border border-white/70',
                    active ? 'bg-green-500' : published ? 'bg-yellow-400' : 'bg-gray-300')} />
              );
            })}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col flex-1 gap-2">
        <div>
          <p className="text-xs text-gray-400 font-mono">{product.sku}</p>
          <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 leading-snug mt-0.5">
            {product.name}
          </h3>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 mt-1">
            {product.model && <span>Model: <strong>{product.model}</strong></span>}
            {kolor && <span>Kolor: <strong>{kolor}</strong></span>}
          </div>
          <p className="text-xs text-gray-500 mt-1"><b>EAN: </b>{product.ean || ' - '}</p>
        </div>

        {/* Footer — base price + per-account prices */}
        <div className="pt-2 border-t border-gray-100 mt-auto space-y-1">
          <div className="flex items-baseline gap-2">
            <div className="text-base font-bold text-gray-900">{basePrice.toFixed(2)} zł</div>
            {isPromo && <div className="text-xs text-gray-400 line-through">{regular.toFixed(2)} zł</div>}
          </div>
          {priceAllegro.map((acc) => {
            if (acc.price === null) return null;
            const diff = acc.price - basePrice;
            const st = offerStatus[acc.id];
            const active = st?.s === 1;
            const published = !!st;
            return (
              <div key={acc.id} className="flex items-center gap-1.5 text-xs">
                <span className={clsx('w-2 h-2 rounded-full shrink-0',
                  active ? 'bg-green-500' : published ? 'bg-yellow-400' : 'bg-gray-300')} />
                <span className="text-gray-500 truncate">{acc.name}:</span>
                <span className="font-semibold text-gray-800">{acc.price.toFixed(2)} zł</span>
                <span className={diff > 0 ? 'text-green-600' : 'text-red-500'}>
                  {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
                </span>
              </div>
            );
          })}
          <div className="text-xs text-gray-400">Ilość: {offerQty} szt.</div>

          {/* Actions — osobne, dedykowane ścieżki CRUD dla każdego marketplace */}
          {onAddToMarketplace ? (
            <div className="grid grid-cols-2 gap-2 pt-2">
              {listMarketplaces().map((m) => (
                <button
                  key={m.slug}
                  onClick={() => onAddToMarketplace(m.slug, product)}
                  className={clsx('text-xs px-3 py-1.5 rounded-md font-semibold text-white transition-colors', ACCENT_CLASSES[m.accent].btn)}
                >
                  + {m.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex gap-2 pt-2">
              <button onClick={() => onAddToAllegro(product)} className="btn-primary btn-sm flex-1 text-xs">+ Allegro</button>
              <button
                onClick={() => onAddToMirakl(product)}
                className="flex-1 text-xs px-3 py-1.5 rounded-md font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
              >
                + Empik
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
