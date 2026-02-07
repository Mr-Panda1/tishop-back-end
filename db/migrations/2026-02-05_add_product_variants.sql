-- Migration: add product_variants and backfill from products.variant_size / variant_color
-- Run this on Postgres. Wrap in transaction when applying in your migration tool.

BEGIN;

-- 1) Create tables if they don't exist
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT UNIQUE,
  size TEXT,
  size_value DECIMAL(4,2),
  color TEXT,
  attributes JSONB DEFAULT '{}'::jsonb,
  price DECIMAL(10,2),
  stock INTEGER DEFAULT 0,
  is_limited_stock BOOLEAN DEFAULT false,
  low_stock_threshold INTEGER DEFAULT 5,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (product_id, size, color)
);

CREATE TABLE IF NOT EXISTS product_variant_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  position INTEGER NOT NULL,
  is_main BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (product_variant_id, position)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_main_image_per_variant
  ON product_variant_images (product_variant_id)
  WHERE is_main = true;

-- 2) Ensure products has `has_variants` column
ALTER TABLE products ADD COLUMN IF NOT EXISTS has_variants BOOLEAN DEFAULT false;

-- 3) Backfill variants in three steps to handle aligned arrays and single-attribute arrays

-- 3a) Products that have both size and color arrays: pair by index (ordinality)
INSERT INTO product_variants (product_id, size, size_value, color, price, stock, created_at, updated_at)
SELECT p.id,
       sz.size,
       (CASE WHEN sz.size ~ '^[0-9]+(\.[0-9]+)?$' THEN sz.size::DECIMAL(4,2) ELSE NULL END) AS size_value,
       cl.color,
       p.price,
       p.stock,
       NOW(), NOW()
FROM products p
JOIN LATERAL unnest(p.variant_size) WITH ORDINALITY AS sz(size, idx) ON p.variant_size IS NOT NULL
JOIN LATERAL unnest(p.variant_color) WITH ORDINALITY AS cl(color, idx) ON p.variant_color IS NOT NULL AND cl.idx = sz.idx
WHERE p.variant_size IS NOT NULL AND p.variant_color IS NOT NULL
ON CONFLICT (product_id, size, color) DO NOTHING;

-- 3b) Products that only have sizes
INSERT INTO product_variants (product_id, size, size_value, price, stock, created_at, updated_at)
SELECT p.id,
       sz.size,
       (CASE WHEN sz.size ~ '^[0-9]+(\.[0-9]+)?$' THEN sz.size::DECIMAL(4,2) ELSE NULL END) AS size_value,
       p.price,
       p.stock,
       NOW(), NOW()
FROM products p
JOIN LATERAL unnest(p.variant_size) WITH ORDINALITY AS sz(size, idx) ON p.variant_size IS NOT NULL
WHERE p.variant_size IS NOT NULL AND (p.variant_color IS NULL OR array_length(p.variant_color, 1) = 0)
ON CONFLICT (product_id, size, color) DO NOTHING;

-- 3c) Products that only have colors
INSERT INTO product_variants (product_id, color, price, stock, created_at, updated_at)
SELECT p.id,
       cl.color,
       p.price,
       p.stock,
       NOW(), NOW()
FROM products p
JOIN LATERAL unnest(p.variant_color) WITH ORDINALITY AS cl(color, idx) ON p.variant_color IS NOT NULL
WHERE p.variant_color IS NOT NULL AND (p.variant_size IS NULL OR array_length(p.variant_size, 1) = 0)
ON CONFLICT (product_id, size, color) DO NOTHING;

-- 4) Mark products that now have variants
UPDATE products
SET has_variants = true
WHERE EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = products.id);

-- 5) Add helpful indexes
CREATE INDEX IF NOT EXISTS idx_product_variants_product_active ON product_variants (product_id, is_active);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku ON product_variants (sku);

-- 6) Drop old array columns (only run after verifying backfill and backups)
ALTER TABLE products DROP COLUMN IF EXISTS variant_size;
ALTER TABLE products DROP COLUMN IF EXISTS variant_color;

COMMIT;

-- End migration
