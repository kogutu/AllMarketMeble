'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Stara trasa Mirakl → przekierowanie na dedykowany CRUD Empik (add-to-empik). */
export default function AddToMiraklRedirect({ params }: { params: { id: string } }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/products/${params.id}/add-to-empik`);
  }, [params.id, router]);
  return <div className="max-w-3xl mx-auto p-8 text-gray-400">Przekierowanie do Empik…</div>;
}
