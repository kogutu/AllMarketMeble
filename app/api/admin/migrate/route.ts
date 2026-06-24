import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST() {
  const steps: string[] = [];
  try {
    await query(`CREATE TABLE IF NOT EXISTS allegro_offer_accounts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      offer_id INT NOT NULL,
      typesense_id VARCHAR(50) NOT NULL,
      account_id VARCHAR(100) NOT NULL,
      allegro_offer_id VARCHAR(100) NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      allegro_title VARCHAR(500) NULL,
      published_at DATETIME NULL,
      last_sync DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_offer_account (offer_id, account_id),
      INDEX idx_typesense_id (typesense_id),
      INDEX idx_allegro_offer_id (allegro_offer_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    steps.push('Table allegro_offer_accounts created');

    await query(`INSERT IGNORE INTO allegro_offer_accounts (offer_id, typesense_id, account_id, allegro_offer_id, status, published_at)
      SELECT id, typesense_id, COALESCE(account_id,'default'), allegro_offer_id, status, updated_at
      FROM allegro_offers WHERE allegro_offer_id IS NOT NULL AND status IN ('active','pending')`);
    steps.push('Backfill done');

    const rows = await query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM allegro_offer_accounts');
    steps.push(`Rows: ${(rows as {cnt:number}[])[0]?.cnt ?? 0}`);

    return NextResponse.json({ ok: true, steps });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), steps }, { status: 500 });
  }
}
