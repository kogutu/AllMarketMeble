-- Run this SQL on hdadmin_allegro MySQL database
-- mysql -u hdadmin_allegro -p hdadmin_allegro < schema.sql

CREATE TABLE IF NOT EXISTS allegro_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id VARCHAR(100) NOT NULL DEFAULT 'default',
  account_name VARCHAR(255) NOT NULL DEFAULT 'Domyślne',
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at DATETIME NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_account_id (account_id)
);

-- Migration (run if table already exists):
-- ALTER TABLE allegro_tokens ADD COLUMN IF NOT EXISTS account_id VARCHAR(100) NOT NULL DEFAULT 'default';
-- ALTER TABLE allegro_tokens ADD COLUMN IF NOT EXISTS account_name VARCHAR(255) NOT NULL DEFAULT 'Domyślne';
-- ALTER TABLE allegro_tokens ADD COLUMN IF NOT EXISTS is_default TINYINT(1) NOT NULL DEFAULT 0;
-- ALTER TABLE allegro_tokens ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1;
-- ALTER TABLE allegro_tokens ADD UNIQUE KEY IF NOT EXISTS uq_account_id (account_id);

CREATE TABLE IF NOT EXISTS allegro_offers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  typesense_id VARCHAR(50) NOT NULL,
  typesense_collection VARCHAR(50) DEFAULT 'meble',
  allegro_offer_id VARCHAR(100) NULL,
  status ENUM('draft','pending','active','ended','error') DEFAULT 'draft',
  category_id VARCHAR(50) NULL,
  title VARCHAR(255) NULL,
  description TEXT NULL,
  price DECIMAL(10,2) NULL,
  quantity INT DEFAULT 1,
  form_data JSON NULL,
  allegro_response JSON NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_typesense_id (typesense_id),
  INDEX idx_allegro_offer_id (allegro_offer_id),
  INDEX idx_status (status)
);

CREATE TABLE IF NOT EXISTS margin_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id VARCHAR(100) NOT NULL COMMENT 'Allegro account_id',
  category_source ENUM('all','typesense','allegro') NOT NULL DEFAULT 'all',
  category_id VARCHAR(100) NOT NULL DEFAULT 'all' COMMENT 'all / typesense kind / allegro category ID',
  category_name VARCHAR(255) NULL,
  margin_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rule (account_id, category_source, category_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS allegro_publish_errors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id VARCHAR(100),
  offer_id INT NULL,
  allegro_offer_id VARCHAR(100) NULL,
  error_json TEXT,
  form_data_snapshot JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_offer_id (offer_id),
  INDEX idx_created_at (created_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Per-account published offers (one row per product × account)
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
  INDEX idx_allegro_offer_id (allegro_offer_id),
  FOREIGN KEY (offer_id) REFERENCES allegro_offers(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_price_overrides (
  id INT AUTO_INCREMENT PRIMARY KEY,
  typesense_id VARCHAR(100) NOT NULL,
  account_id VARCHAR(100) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_account (typesense_id, account_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
