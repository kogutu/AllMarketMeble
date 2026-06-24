const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env.local' });

async function columnExists(conn, table, column) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [process.env.MYSQL_DATABASE, table, column]
  );
  return rows.length > 0;
}

async function addColumn(conn, table, column, definition) {
  if (await columnExists(conn, table, column)) {
    console.log(`  - ${table}.${column} already exists, skipping`);
    return;
  }
  await conn.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`  + added ${table}.${column}`);
}

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
  });

  console.log(`Running migrations on ${process.env.MYSQL_HOST}/${process.env.MYSQL_DATABASE} ...`);

  // ── Base schema (mirrors scripts/schema.sql) — safe on a fresh database ─────
  await connection.execute(`
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
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS allegro_offers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      typesense_id VARCHAR(50) NOT NULL,
      typesense_collection VARCHAR(50) DEFAULT 'meble',
      allegro_offer_id VARCHAR(100) NULL,
      account_id VARCHAR(100) NULL,
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
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS margin_rules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      account_id VARCHAR(100) NOT NULL,
      category_source ENUM('all','typesense','allegro','mirakl') NOT NULL DEFAULT 'all',
      category_id VARCHAR(100) NOT NULL DEFAULT 'all',
      category_name VARCHAR(255) NULL,
      margin_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_rule (account_id, category_source, category_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await connection.execute(`
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
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await connection.execute(`
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
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS product_price_overrides (
      id INT AUTO_INCREMENT PRIMARY KEY,
      typesense_id VARCHAR(100) NOT NULL,
      account_id VARCHAR(100) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_product_account (typesense_id, account_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  // base_price is used by the publish route but not in the original schema.sql
  await addColumn(connection, 'allegro_offers', 'base_price', 'DECIMAL(10,2) NULL');

  // ── Migration 001: multi-marketplace (Allegro + Mirakl/Empik) ──────────────
  console.log('001_marketplace: accounts');
  await addColumn(connection, 'allegro_tokens', 'marketplace', "VARCHAR(20) NOT NULL DEFAULT 'allegro'");
  await addColumn(connection, 'allegro_tokens', 'operator', 'VARCHAR(50) NULL');
  await addColumn(connection, 'allegro_tokens', 'api_key', 'TEXT NULL');
  await addColumn(connection, 'allegro_tokens', 'base_url', 'VARCHAR(255) NULL');

  console.log('001_marketplace: drafts');
  await addColumn(connection, 'allegro_offers', 'marketplace', "VARCHAR(20) NOT NULL DEFAULT 'allegro'");
  await addColumn(connection, 'allegro_offers', 'mirakl_shop_sku', 'VARCHAR(100) NULL');
  await addColumn(connection, 'allegro_offers', 'mirakl_product_import_id', 'VARCHAR(100) NULL');
  await addColumn(connection, 'allegro_offers', 'mirakl_offer_import_id', 'VARCHAR(100) NULL');
  await addColumn(connection, 'allegro_offers', 'mirakl_state', 'VARCHAR(50) NULL');

  console.log('001_marketplace: publications');
  await addColumn(connection, 'allegro_offer_accounts', 'marketplace', "VARCHAR(20) NOT NULL DEFAULT 'allegro'");

  console.log('001_marketplace: margin_rules ENUM');
  await connection.execute(
    `ALTER TABLE margin_rules
       MODIFY COLUMN category_source ENUM('all','typesense','allegro','mirakl') NOT NULL DEFAULT 'all'`
  );

  console.log('001_marketplace: mapping tables');
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS mirakl_category_map (
      id INT AUTO_INCREMENT PRIMARY KEY,
      operator VARCHAR(50) NOT NULL,
      source_kind VARCHAR(100) NOT NULL,
      mirakl_category_code VARCHAR(255) NOT NULL,
      mirakl_category_label VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cat (operator, source_kind)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS mirakl_attribute_map (
      id INT AUTO_INCREMENT PRIMARY KEY,
      operator VARCHAR(50) NOT NULL,
      mirakl_category_code VARCHAR(255) NOT NULL,
      attribute_code VARCHAR(255) NOT NULL,
      source_field VARCHAR(100) NULL,
      fixed_value VARCHAR(255) NULL,
      value_map JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_attr (operator, mirakl_category_code, attribute_code)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  console.log('002_live_offers: marketplace_live_offers');
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS marketplace_live_offers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      marketplace ENUM('allegro','mirakl') NOT NULL,
      ref VARCHAR(100) NOT NULL,
      ean VARCHAR(20) NULL,
      typesense_id VARCHAR(50) NULL,
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
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await addColumn(connection, 'marketplace_live_offers', 'marketplace_offer_id', 'VARCHAR(100) NULL');

  // 004_persist_offers: store full offer payload so the grid reads from DB (no marketplace API on view)
  console.log('004_persist_offers: JSON columns + sync_jobs');
  await addColumn(connection, 'marketplace_live_offers', 'raw_json', 'JSON NULL');   // flattened offer fields
  await addColumn(connection, 'marketplace_live_offers', 'base_json', 'JSON NULL');  // Typesense base snapshot
  await addColumn(connection, 'marketplace_live_offers', 'meta_json', 'JSON NULL');  // edit meta (stateCode, leadtime…)
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS sync_jobs (
      marketplace VARCHAR(20) NOT NULL PRIMARY KEY,
      status ENUM('idle','running','done','error') NOT NULL DEFAULT 'idle',
      processed INT NOT NULL DEFAULT 0,
      total INT NOT NULL DEFAULT 0,
      message VARCHAR(500) NULL,
      started_at DATETIME NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  // 003_marketplace_slug: marketplace column now holds the user-facing slug (empik/brw/kaufland/allegro)
  console.log('003_marketplace_slug: marketplace -> VARCHAR(slug)');
  await connection.execute(`ALTER TABLE marketplace_live_offers MODIFY COLUMN marketplace VARCHAR(20) NOT NULL`);
  await connection.execute(`UPDATE marketplace_live_offers SET marketplace = 'empik' WHERE marketplace = 'mirakl'`);

  // 005_grid_views: saved table views (per marketplace), drag-drop column config
  console.log('005_grid_views');
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS grid_views (
      id INT AUTO_INCREMENT PRIMARY KEY,
      marketplace VARCHAR(20) NOT NULL,
      name VARCHAR(120) NOT NULL,
      columns_json JSON NOT NULL,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_market (marketplace)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  console.log('Migrations completed successfully.');
  await connection.end();
}

migrate().catch((e) => { console.error(e); process.exit(1); });
