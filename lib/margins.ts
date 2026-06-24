export interface MarginRule {
  id: number;
  account_id: string;
  category_source: 'all' | 'typesense' | 'allegro' | 'mirakl';
  category_id: string;
  category_name: string | null;
  margin_pct: number;
}

/**
 * Finds the best margin rule for a product + account.
 * Priority: allegro category > typesense kind > all.
 * Rules with account_id='__all__' serve as fallback when no account-specific rule matches.
 */
export function matchMargin(
  rules: MarginRule[],
  product: { kind?: string },
  accountId: string,
  allegroCategory?: string | null
): MarginRule | null {
  const find = (candidates: MarginRule[]): MarginRule | null => {
    if (allegroCategory) {
      const r = candidates.find((r) => r.category_source === 'allegro' && r.category_id === allegroCategory);
      if (r) return r;
    }
    if (product.kind) {
      const r = candidates.find((r) => r.category_source === 'typesense' && r.category_id === product.kind);
      if (r) return r;
    }
    return candidates.find((r) => r.category_source === 'all') ?? null;
  };

  // Try account-specific rules first, then fall back to '__all__' global rules
  return find(rules.filter((r) => r.account_id === accountId))
    ?? find(rules.filter((r) => r.account_id === '__all__'));
}

export function applyMargin(price: number, marginPct: number): number {
  return Math.round(price * (1 + marginPct / 100) * 100) / 100;
}
