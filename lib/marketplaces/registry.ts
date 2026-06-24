import { queryOne } from '@/lib/db';
import type { MarketplaceAdapter } from './types';
import type { MarketplaceKind } from '@/types';
import { AllegroAdapter } from './allegro/adapter';
import { MiraklAdapter } from './mirakl/adapter';
import { KauflandAdapter } from './kaufland/adapter';
import { getOperator } from './mirakl/operators';
import { getMarketplace } from './catalog';

/** Resolve the adapter for a user-facing marketplace slug (allegro|empik|brw|kaufland). */
export async function getAdapterBySlug(slug: string): Promise<MarketplaceAdapter> {
  const def = getMarketplace(slug);
  if (!def) throw new Error(`Unknown marketplace slug: ${slug}`);
  if (def.engine === 'mirakl') return MiraklAdapter.create(def.operator!, def.operator!);
  if (def.engine === 'kaufland') return KauflandAdapter.create('kaufland');
  return new AllegroAdapter(def.operator || 'default');
}

interface AccountRow {
  marketplace: MarketplaceKind | null;
  operator: string | null;
}

/**
 * Resolve the marketplace adapter for an account. Looks up the account's marketplace/operator
 * in `allegro_tokens`; Allegro accounts (or unknown ids) fall back to the Allegro adapter so the
 * existing behavior is unchanged.
 */
export async function getAdapter(accountId = 'default'): Promise<MarketplaceAdapter> {
  const row = await queryOne<AccountRow>(
    `SELECT marketplace, operator FROM allegro_tokens WHERE account_id = ? LIMIT 1`,
    [accountId]
  );

  if (row?.marketplace === 'mirakl') {
    if (!row.operator) throw new Error(`Mirakl account ${accountId} has no operator configured`);
    return MiraklAdapter.create(row.operator, accountId);
  }
  if (row?.marketplace === 'kaufland') {
    return KauflandAdapter.create(accountId);
  }

  // No DB row, but the account id matches a known Mirakl operator → use env credentials.
  if (!row && getOperator(accountId)) {
    return MiraklAdapter.create(accountId, accountId);
  }

  // Kaufland account id (or 'kaufland' slug) → Kaufland adapter (storefront-based, no DB row needed).
  if (accountId === 'kaufland' || getMarketplace(accountId)?.engine === 'kaufland') {
    return KauflandAdapter.create('kaufland');
  }

  return new AllegroAdapter(accountId);
}

/** Resolve an adapter for a specific marketplace/operator without an existing account row. */
export async function getAdapterFor(
  marketplace: MarketplaceKind,
  accountId: string,
  operator?: string
): Promise<MarketplaceAdapter> {
  if (marketplace === 'mirakl') {
    if (!operator) throw new Error('Mirakl adapter requires an operator id');
    return MiraklAdapter.create(operator, accountId);
  }
  return new AllegroAdapter(accountId);
}
