ALTER TABLE orders
ADD COLUMN IF NOT EXISTS manual_payment_proof_path TEXT,
ADD COLUMN IF NOT EXISTS manual_payment_proof_iv TEXT,
ADD COLUMN IF NOT EXISTS manual_payment_proof_auth_tag TEXT,
ADD COLUMN IF NOT EXISTS manual_payment_proof_hash TEXT,
ADD COLUMN IF NOT EXISTS manual_payment_proof_mime_type TEXT;