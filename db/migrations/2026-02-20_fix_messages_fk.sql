-- Remove foreign key constraint on messages.sender_id
-- Allow sender_id to be either user_id (for sellers) or customer_id (for guests)
-- sender_type column indicates which table the sender_id references

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;

-- Also remove receiver_id foreign key for consistency
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_receiver_id_fkey;
