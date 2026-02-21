-- RLS Policies for Public Chat Widget
-- Allows unauthenticated customers to interact with chat without breaking seller security
-- IMPORTANT: This removes all existing policies and creates new ones
-- Deployed: 2026-02-20

-- ============================================
-- BACKUP: Save existing policies before deletion
-- Then run: SELECT * FROM pg_policies WHERE tablename IN ('shops', 'sellers', 'customers', 'conversations', 'messages', 'seller_quick_responses', 'seller_auto_replies', 'seller_availability');
-- ============================================

-- ============================================
-- DISABLE AND DROP ALL EXISTING POLICIES
-- ============================================

-- Drop existing policies on shops
DROP POLICY IF EXISTS "Allow public read access to shops" ON shops;
DROP POLICY IF EXISTS "Sellers can update their own shops" ON shops;
-- Add any other shop policies here

-- Drop existing policies on sellers  
DROP POLICY IF EXISTS "Allow public read access to sellers" ON sellers;
DROP POLICY IF EXISTS "Sellers can update their own seller profile" ON sellers;

-- Drop existing policies on customers
DROP POLICY IF EXISTS "Allow public read access to customer records" ON customers;
DROP POLICY IF EXISTS "Allow guests to create customer records" ON customers;
DROP POLICY IF EXISTS "Allow guests to read their own customer record" ON customers;

-- Drop existing policies on conversations
DROP POLICY IF EXISTS "Allow guests to create conversations" ON conversations;
DROP POLICY IF EXISTS "Allow guests to read their own conversations" ON conversations;
DROP POLICY IF EXISTS "Sellers can read their conversations" ON conversations;

-- Drop existing policies on messages
DROP POLICY IF EXISTS "Allow guests to create messages" ON messages;
DROP POLICY IF EXISTS "Allow guests to read conversation messages" ON messages;
DROP POLICY IF EXISTS "Sellers can read messages in their conversations" ON messages;
DROP POLICY IF EXISTS "Sellers can update message read status" ON messages;

-- Drop existing policies on seller_quick_responses
DROP POLICY IF EXISTS "Allow public read access to active quick responses" ON seller_quick_responses;
DROP POLICY IF EXISTS "Sellers can manage their quick responses" ON seller_quick_responses;
DROP POLICY IF EXISTS "Sellers can manage their quick responses delete" ON seller_quick_responses;

-- Drop existing policies on seller_auto_replies
DROP POLICY IF EXISTS "Allow public read access to auto replies" ON seller_auto_replies;
DROP POLICY IF EXISTS "Sellers can manage their auto replies" ON seller_auto_replies;

-- Drop existing policies on seller_availability
DROP POLICY IF EXISTS "Allow public read access to seller availability" ON seller_availability;

-- ============================================
-- SHOPS: Public readable, seller-controlled updates
-- ============================================
CREATE POLICY "shops_select_all" ON shops FOR SELECT USING (true);
CREATE POLICY "shops_update_own" ON shops FOR UPDATE TO authenticated USING (seller_id = auth.uid()) WITH CHECK (seller_id = auth.uid());
CREATE POLICY "shops_delete_own" ON shops FOR DELETE TO authenticated USING (seller_id = auth.uid());

-- ============================================
-- SELLERS: Public readable, seller self-update only
-- ============================================
CREATE POLICY "sellers_select_all" ON sellers FOR SELECT USING (true);
CREATE POLICY "sellers_update_own" ON sellers FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================
-- CUSTOMERS: Allow anyone to create/read/update
-- (No auth required for guest messaging)
-- ============================================
CREATE POLICY "customers_select_all" ON customers FOR SELECT USING (true);
CREATE POLICY "customers_insert_all" ON customers FOR INSERT WITH CHECK (true);
CREATE POLICY "customers_update_all" ON customers FOR UPDATE USING (true) WITH CHECK (true);

-- ============================================
-- CONVERSATIONS: Public accessible for chat
-- ============================================
CREATE POLICY "conversations_select_all" ON conversations FOR SELECT USING (true);
CREATE POLICY "conversations_insert_all" ON conversations FOR INSERT WITH CHECK (true);
CREATE POLICY "conversations_update_all" ON conversations FOR UPDATE USING (true) WITH CHECK (true);

-- ============================================
-- MESSAGES: Public accessible for guest chat
-- ============================================
CREATE POLICY "messages_select_all" ON messages FOR SELECT USING (true);
CREATE POLICY "messages_insert_all" ON messages FOR INSERT WITH CHECK (true);
CREATE POLICY "messages_update_all" ON messages FOR UPDATE USING (true) WITH CHECK (true);

-- ============================================
-- SELLER QUICK RESPONSES: Public read, seller write
-- ============================================
CREATE POLICY "quick_responses_select_active" ON seller_quick_responses FOR SELECT USING (is_active = true);
CREATE POLICY "quick_responses_insert_own" ON seller_quick_responses FOR INSERT TO authenticated WITH CHECK (seller_id = auth.uid());
CREATE POLICY "quick_responses_update_own" ON seller_quick_responses FOR UPDATE TO authenticated USING (seller_id = auth.uid()) WITH CHECK (seller_id = auth.uid());
CREATE POLICY "quick_responses_delete_own" ON seller_quick_responses FOR DELETE TO authenticated USING (seller_id = auth.uid());

-- ============================================
-- SELLER AUTO REPLIES: Public read, seller write
-- ============================================
CREATE POLICY "auto_replies_select_all" ON seller_auto_replies FOR SELECT USING (true);
CREATE POLICY "auto_replies_insert_own" ON seller_auto_replies FOR INSERT TO authenticated WITH CHECK (seller_id = auth.uid());
CREATE POLICY "auto_replies_update_own" ON seller_auto_replies FOR UPDATE TO authenticated USING (seller_id = auth.uid()) WITH CHECK (seller_id = auth.uid());

-- ============================================
-- SELLER AVAILABILITY: Public read, seller write
-- ============================================
CREATE POLICY "availability_select_all" ON seller_availability FOR SELECT USING (true);
CREATE POLICY "availability_insert_own" ON seller_availability FOR INSERT TO authenticated WITH CHECK (seller_id = auth.uid());
CREATE POLICY "availability_update_own" ON seller_availability FOR UPDATE TO authenticated USING (seller_id = auth.uid()) WITH CHECK (seller_id = auth.uid());
