-- Database Migration: Add encryption metadata columns to kyc_files table
-- Run this migration to support encrypted KYC file storage

-- Add encryption metadata columns for id_front file
ALTER TABLE kyc_files ADD COLUMN id_front_iv VARCHAR(255);
ALTER TABLE kyc_files ADD COLUMN id_front_auth_tag VARCHAR(255);
ALTER TABLE kyc_files ADD COLUMN id_front_hash VARCHAR(64);

-- Add encryption metadata columns for id_back file
ALTER TABLE kyc_files ADD COLUMN id_back_iv VARCHAR(255);
ALTER TABLE kyc_files ADD COLUMN id_back_auth_tag VARCHAR(255);
ALTER TABLE kyc_files ADD COLUMN id_back_hash VARCHAR(64);

-- Add encryption metadata columns for selfie file
ALTER TABLE kyc_files ADD COLUMN selfie_iv VARCHAR(255);
ALTER TABLE kyc_files ADD COLUMN selfie_auth_tag VARCHAR(255);
ALTER TABLE kyc_files ADD COLUMN selfie_hash VARCHAR(64);

-- Add flag to indicate if files are encrypted
ALTER TABLE kyc_files ADD COLUMN are_encrypted BOOLEAN DEFAULT true;

-- Create index for faster lookups by kyc_document_id and encryption flag
CREATE INDEX IF NOT EXISTS idx_kyc_files_document_encrypted 
ON kyc_files(kyc_document_id, are_encrypted);

-- Add comments for documentation
COMMENT ON COLUMN kyc_files.id_front_iv IS 'Initialization vector for AES-256-GCM encryption (hex)';
COMMENT ON COLUMN kyc_files.id_front_auth_tag IS 'Authentication tag for AES-256-GCM encryption (hex)';
COMMENT ON COLUMN kyc_files.id_front_hash IS 'SHA-256 hash for integrity verification (hex)';
COMMENT ON COLUMN kyc_files.are_encrypted IS 'Flag indicating if files are encrypted (true for new uploads)';
