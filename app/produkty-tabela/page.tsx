'use client';

import ProductsTable from '@/components/products/ProductsTable';

export default function ProduktyTabelaPage() {
  return (
    <div className="max-w-[1600px] mx-auto space-y-3">
      <h1 className="text-lg font-semibold text-gray-900">Produkty — tabela</h1>
      <ProductsTable />
    </div>
  );
}
