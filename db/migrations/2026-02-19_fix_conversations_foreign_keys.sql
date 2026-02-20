-- Migration: Fix conversations table foreign keys to reference customers table
-- This allows Supabase relationship queries to work correctly

BEGIN;

-- First, we need to handle the existing data
-- Update conversations to use customer IDs that match the customers table
-- Assuming customer_id in conversations should reference customers.id where customers.user_id = conversations.customer_id

-- Create a temporary column to help with the migration
ALTER TABLE conversations ADD COLUMN customer_id_new UUID;

-- Update the new column to reference customers.id based on customer's user_id
UPDATE conversations c
SET customer_id_new = cust.id
FROM customers cust
WHERE cust.user_id = c.customer_id;

-- If there are conversations with no matching customer, keep them NULL or handle as needed
-- Then drop the old foreign key constraint
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_customer_id_fkey;

-- Drop the old column
ALTER TABLE conversations DROP COLUMN customer_id;

-- Rename the new column
ALTER TABLE conversations RENAME COLUMN customer_id_new TO customer_id;

-- Add the new foreign key constraint
ALTER TABLE conversations 
ADD CONSTRAINT conversations_customer_id_fkey 
FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

-- Make it NOT NULL if needed (remove NOT NULL if some conversations can exist without a customer)
-- ALTER TABLE conversations ALTER COLUMN customer_id SET NOT NULL;

COMMIT;
