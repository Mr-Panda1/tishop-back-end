ALTER TABLE orders
ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'moncash'
  CHECK (payment_method IN ('moncash', 'manual')),
ADD COLUMN IF NOT EXISTS manual_payment_reference TEXT,
ADD COLUMN IF NOT EXISTS manual_payment_sender_phone TEXT,
ADD COLUMN IF NOT EXISTS manual_payment_screenshot_name TEXT,
ADD COLUMN IF NOT EXISTS manual_payment_submitted_at TIMESTAMPTZ;
