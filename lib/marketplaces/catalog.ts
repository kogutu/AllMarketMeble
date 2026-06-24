import type { MarketplaceEngine, MarketplaceSlug } from '@/types';

export type MarketplaceAccent = 'allegro' | 'indigo' | 'red' | 'green';

export interface MarketplaceDef {
  slug: MarketplaceSlug;     // user-facing id: 'allegro' | 'empik' | 'brw' | 'kaufland'
  name: string;             // display name
  engine: MarketplaceEngine;
  operator?: string;        // Mirakl operator id (empik|brw); Allegro account id; Kaufland storefront
  badge: string;            // short letter for product cards
  accent: MarketplaceAccent;
}

/**
 * Central registry of marketplaces. Adding a new marketplace = one entry here
 * (+ a new engine adapter only if it is not Allegro/Mirakl/Kaufland).
 */
export const MARKETPLACES: MarketplaceDef[] = [
  { slug: 'allegro', name: 'Allegro', engine: 'allegro', operator: 'default', badge: 'A', accent: 'allegro' },
  { slug: 'empik', name: 'Empik', engine: 'mirakl', operator: 'empik', badge: 'E', accent: 'indigo' },
  { slug: 'brw', name: 'Black Red White', engine: 'mirakl', operator: 'brw', badge: 'B', accent: 'red' },
  { slug: 'kaufland', name: 'Kaufland', engine: 'kaufland', operator: 'pl', badge: 'K', accent: 'green' },
];

export function getMarketplace(slug: string): MarketplaceDef | undefined {
  return MARKETPLACES.find((m) => m.slug === slug);
}

export function listMarketplaces(): MarketplaceDef[] {
  return MARKETPLACES;
}

/** Tailwind classes per accent (badge / primary button). */
export const ACCENT_CLASSES: Record<MarketplaceAccent, { btn: string; spinner: string; bar: string; text: string }> = {
  allegro: { btn: 'bg-allegro hover:bg-allegro/90', spinner: 'border-amber-300 border-t-amber-600', bar: 'bg-amber-500', text: 'text-allegro' },
  indigo: { btn: 'bg-indigo-600 hover:bg-indigo-700', spinner: 'border-indigo-300 border-t-indigo-600', bar: 'bg-indigo-600', text: 'text-indigo-600' },
  red: { btn: 'bg-red-600 hover:bg-red-700', spinner: 'border-red-300 border-t-red-600', bar: 'bg-red-600', text: 'text-red-600' },
  green: { btn: 'bg-green-600 hover:bg-green-700', spinner: 'border-green-300 border-t-green-600', bar: 'bg-green-600', text: 'text-green-600' },
};
