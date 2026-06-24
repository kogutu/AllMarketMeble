'use client';

import { useParams } from 'next/navigation';
import type { ComponentType } from 'react';
import EmpikGrid from '@/components/marketplace/grids/EmpikGrid';
import AllegroGrid from '@/components/marketplace/grids/AllegroGrid';
import BrwGrid from '@/components/marketplace/grids/BrwGrid';
import KauflandGrid from '@/components/marketplace/grids/KauflandGrid';

// Każdy marketplace ma własny, niezależny komponent siatki (pełna logika w osobnym pliku).
const GRIDS: Record<string, ComponentType> = {
  empik: EmpikGrid,
  allegro: AllegroGrid,
  brw: BrwGrid,
  kaufland: KauflandGrid,
};

export default function MarketplacePage() {
  const params = useParams();
  const slug = String(params.slug);
  const Grid = GRIDS[slug];

  if (!Grid) {
    return <div className="max-w-3xl mx-auto p-8 text-gray-500">Nieznany marketplace: {slug}</div>;
  }
  return <Grid />;
}
