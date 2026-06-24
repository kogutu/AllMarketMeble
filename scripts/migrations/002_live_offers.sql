-- Migration 002: persisted live marketplace offers (Empik + Allegro)
-- Source of truth for "listed/active" status on the Products page. Populated by /api/marketplace/sync-live.

CREATE TABLE IF NOT EXISTS marketplace_live_offers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  marketplace ENUM('allegro','mirakl') NOT NULL,
  ref VARCHAR(100) NOT NULL,            -- edit key: allegro_offer_id | shop_sku (Empik)
  marketplace_offer_id VARCHAR(100) NULL, -- native marketplace offer id (Empik numeric offer_id / Allegro offer id)
  ean VARCHAR(20) NULL,
  typesense_id VARCHAR(50) NULL,        -- matched base product
  active TINYINT(1) NOT NULL DEFAULT 1,
  price DECIMAL(10,2) NULL,
  quantity INT NULL,
  title VARCHAR(500) NULL,
  account_id VARCHAR(100) NULL,
  synced_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_market_ref (marketplace, ref),
  INDEX idx_ean (ean),
  INDEX idx_typesense_id (typesense_id),
  INDEX idx_market_ts (marketplace, typesense_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
