-- Run this after restarting the dev server (releases stale connections)
-- mysql -h hd-098.stpl.net.pl -u hdadmin_allegro -p hdadmin_allegro < migrate-offer-accounts.sql

CREATE TABLE IF NOT EXISTS allegro_offer_accounts (
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
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill existing active offers
INSERT IGNORE INTO allegro_offer_accounts (offer_id, typesense_id, account_id, allegro_offer_id, status, published_at)
SELECT id, typesense_id, COALESCE(account_id, 'default'), allegro_offer_id, status, updated_at
FROM allegro_offers
WHERE allegro_offer_id IS NOT NULL AND status IN ('active', 'pending');
