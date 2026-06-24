'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MebleProduct } from '@/types';
import BrwOfferForm from '@/components/marketplace/crud/BrwOfferForm';

export default function AddToBrwPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [product, setProduct] = useState<MebleProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/products/${params.id}`)
      .then((r) => { if (!r.ok) throw new Error('Produkt nie znaleziony'); return r.json(); })
      .then(setProduct)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [params.id]);

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
          <button onClick={() => router.push('/products')} className="btn-secondary mt-4">← Wróć do listy</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <nav className="text-sm text-gray-500 flex items-center gap-1">
        <button onClick={() => router.push('/products')} className="hover:text-gray-700">Produkty</button>
        <span>/</span>
        <span className="text-gray-900 font-medium truncate max-w-xs">{product.name}</span>
        <span>/</span>
        <span className="text-red-600 font-medium">Dodaj do Black Red White</span>
      </nav>

      <div className="card p-4 flex items-center gap-4">
        {(product.img || product.gallery_images?.[0]) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.img || product.gallery_images[0]} alt={product.name}
            className="w-16 h-16 object-contain bg-gray-50 rounded-lg" />
        )}
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{product.name}</p>
          <p className="text-xs text-gray-500">
            SKU: {product.sku} · EAN: {product.ean || '—'} · {product.price_gross?.toFixed(2)} zł · {product.qty} szt.
          </p>
        </div>
      </div>

      <BrwOfferForm product={product} />
    </div>
  );
}
