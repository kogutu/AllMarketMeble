-- Migration 001: multi-marketplace support (Allegro + Mirakl/Empik)
-- Additive only. Existing Allegro rows default to marketplace='allegro'.
-- Idempotent execution is handled by scripts/migrate.js (information_schema guards).
-- This file is the canonical reference; you may also apply it manually on MariaDB
-- (which supports `ADD COLUMN IF NOT EXISTS`). On MySQL 8 use migrate.js instead.

-- 1) Accounts: store marketplace kind + Mirakl credentials alongside Allegro OAuth tokens.
ALTER TABLE allegro_tokens
  ADD COLUMN marketplace VARCHAR(20) NOT NULL DEFAULT 'allegro' AFTER account_name,
  ADD COLUMN operator    VARCHAR(50) NULL AFTER marketplace,   -- Mirakl operator id (e.g. 'empik')
  ADD COLUMN api_key      TEXT        NULL,                     -- Mirakl shop API key
  ADD COLUMN base_url      VARCHAR(255) NULL;                    -- Mirakl operator base URL override

-- 2) Drafts: marketplace discriminator + Mirakl async import tracking.
ALTER TABLE allegro_offers
  ADD COLUMN marketplace             VARCHAR(20)  NOT NULL DEFAULT 'allegro' AFTER typesense_collection,
  ADD COLUMN mirakl_shop_sku         VARCHAR(100) NULL,
  ADD COLUMN mirakl_product_import_id VARCHAR(100) NULL,
  ADD COLUMN mirakl_offer_import_id   VARCHAR(100) NULL,
  ADD COLUMN mirakl_state            VARCHAR(50)  NULL;

-- 3) Per-account publications: marketplace discriminator.
ALTER TABLE allegro_offer_accounts
  ADD COLUMN marketplace VARCHAR(20) NOT NULL DEFAULT 'allegro' AFTER account_id;

-- 4) Margin rules: allow Mirakl category source.
ALTER TABLE margin_rules
  MODIFY COLUMN category_source ENUM('all','typesense','allegro','mirakl') NOT NULL DEFAULT 'all';

-- 5) Mirakl category mapping: source product kind/category -> operator category code.
CREATE TABLE IF NOT EXISTS mirakl_category_map (
  id INT AUTO_INCREMENT PRIMARY KEY,
  operator VARCHAR(50) NOT NULL,
  source_kind VARCHAR(100) NOT NULL,            -- TyreProduct.kind (or 'all')
  mirakl_category_code VARCHAR(255) NOT NULL,
  mirakl_category_label VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cat (operator, source_kind)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 6) Mirakl attribute mapping: operator category attribute -> source field / fixed value.
CREATE TABLE IF NOT EXISTS mirakl_attribute_map (
  id INT AUTO_INCREMENT PRIMARY KEY,
  operator VARCHAR(50) NOT NULL,
  mirakl_category_code VARCHAR(255) NOT NULL,
  attribute_code VARCHAR(255) NOT NULL,
  source_field VARCHAR(100) NULL,               -- field on TyreProduct/formData, NULL if fixed_value used
  fixed_value VARCHAR(255) NULL,                 -- constant value when not mapped from a field
  value_map JSON NULL,                          -- optional source-value -> value-list code map
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_attr (operator, mirakl_category_code, attribute_code)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
