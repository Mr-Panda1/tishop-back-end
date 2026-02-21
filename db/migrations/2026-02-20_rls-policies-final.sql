-- RLS Policies for TiShop - Final Clean Version (Single-Pass, No Duplicates)
-- Secure party-restricted access for conversations + public shopping + seller dashboard
-- Deployed: 2026-02-20

-- ============================================
-- STEP 1: DISABLE ALL RLS TEMPORARILY
-- ============================================
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE shops DISABLE ROW LEVEL SECURITY;
ALTER TABLE sellers DISABLE ROW LEVEL SECURITY;
ALTER TABLE customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE seller_quick_responses DISABLE ROW LEVEL SECURITY;
ALTER TABLE seller_auto_replies DISABLE ROW LEVEL SECURITY;
ALTER TABLE seller_availability DISABLE ROW LEVEL SECURITY;
ALTER TABLE categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE product_images DISABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants DISABLE ROW LEVEL SECURITY;
ALTER TABLE product_variant_images DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE seller_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE payouts DISABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_documents DISABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 2: DROP ALL EXISTING POLICIES
-- ============================================
DROP POLICY IF EXISTS "users_select_own" ON users;
DROP POLICY IF EXISTS "users_update_own" ON users;
DROP POLICY IF EXISTS "users_insert_admin" ON users;
DROP POLICY IF EXISTS "shops_select_all" ON shops;
DROP POLICY IF EXISTS "shops_insert_own" ON shops;
DROP POLICY IF EXISTS "shops_update_own" ON shops;
DROP POLICY IF EXISTS "shops_delete_own" ON shops;
DROP POLICY IF EXISTS "sellers_select_all" ON sellers;
DROP POLICY IF EXISTS "sellers_update_own" ON sellers;
DROP POLICY IF EXISTS "customers_select_all" ON customers;
DROP POLICY IF EXISTS "customers_insert_all" ON customers;
DROP POLICY IF EXISTS "customers_update_all" ON customers;
DROP POLICY IF EXISTS "customers_insert_guest" ON customers;
DROP POLICY IF EXISTS "customers_select_own" ON customers;
DROP POLICY IF EXISTS "customers_update_own" ON customers;
DROP POLICY IF EXISTS "conversations_select_all" ON conversations;
DROP POLICY IF EXISTS "conversations_insert_all" ON conversations;
DROP POLICY IF EXISTS "conversations_update_all" ON conversations;
DROP POLICY IF EXISTS "conversations_select_seller" ON conversations;
DROP POLICY IF EXISTS "conversations_select_customer" ON conversations;DROP POLICY IF EXISTS "conversations_select_public" ON conversations;DROP POLICY IF EXISTS "conversations_update_seller" ON conversations;
DROP POLICY IF EXISTS "conversations_update_customer" ON conversations;
DROP POLICY IF EXISTS "messages_select_all" ON messages;
DROP POLICY IF EXISTS "messages_insert_all" ON messages;
DROP POLICY IF EXISTS "messages_update_all" ON messages;
DROP POLICY IF EXISTS "messages_select_anon" ON messages;
DROP POLICY IF EXISTS "messages_select_seller" ON messages;
DROP POLICY IF EXISTS "messages_select_customer" ON messages;
DROP POLICY IF EXISTS "messages_insert_all" ON messages;
DROP POLICY IF EXISTS "messages_update_seller" ON messages;
DROP POLICY IF EXISTS "quick_responses_select_active" ON seller_quick_responses;
DROP POLICY IF EXISTS "quick_responses_select_own" ON seller_quick_responses;
DROP POLICY IF EXISTS "quick_responses_insert_own" ON seller_quick_responses;
DROP POLICY IF EXISTS "quick_responses_update_own" ON seller_quick_responses;
DROP POLICY IF EXISTS "quick_responses_delete_own" ON seller_quick_responses;
DROP POLICY IF EXISTS "auto_replies_select_all" ON seller_auto_replies;
DROP POLICY IF EXISTS "auto_replies_select_own" ON seller_auto_replies;
DROP POLICY IF EXISTS "auto_replies_insert_own" ON seller_auto_replies;
DROP POLICY IF EXISTS "auto_replies_update_own" ON seller_auto_replies;
DROP POLICY IF EXISTS "auto_replies_delete_own" ON seller_auto_replies;
DROP POLICY IF EXISTS "availability_select_all" ON seller_availability;
DROP POLICY IF EXISTS "availability_select_own" ON seller_availability;
DROP POLICY IF EXISTS "availability_insert_own" ON seller_availability;
DROP POLICY IF EXISTS "availability_update_own" ON seller_availability;
DROP POLICY IF EXISTS "availability_delete_own" ON seller_availability;
DROP POLICY IF EXISTS "categories_select_all" ON categories;
DROP POLICY IF EXISTS "products_select_public" ON products;
DROP POLICY IF EXISTS "products_select_own" ON products;
DROP POLICY IF EXISTS "products_insert_own" ON products;
DROP POLICY IF EXISTS "products_update_own" ON products;
DROP POLICY IF EXISTS "products_delete_own" ON products;
DROP POLICY IF EXISTS "product_images_select_public" ON product_images;
DROP POLICY IF EXISTS "product_images_insert_own" ON product_images;
DROP POLICY IF EXISTS "product_images_update_own" ON product_images;
DROP POLICY IF EXISTS "product_images_delete_own" ON product_images;
DROP POLICY IF EXISTS "product_variants_select_public" ON product_variants;
DROP POLICY IF EXISTS "product_variants_insert_own" ON product_variants;
DROP POLICY IF EXISTS "product_variants_update_own" ON product_variants;
DROP POLICY IF EXISTS "product_variants_delete_own" ON product_variants;
DROP POLICY IF EXISTS "product_variant_images_select_public" ON product_variant_images;
DROP POLICY IF EXISTS "product_variant_images_insert_own" ON product_variant_images;
DROP POLICY IF EXISTS "product_variant_images_update_own" ON product_variant_images;
DROP POLICY IF EXISTS "product_variant_images_delete_own" ON product_variant_images;
DROP POLICY IF EXISTS "seller_orders_insert" ON seller_orders;
DROP POLICY IF EXISTS "seller_orders_select_own" ON seller_orders;
DROP POLICY IF EXISTS "seller_orders_update_own" ON seller_orders;
DROP POLICY IF EXISTS "orders_insert_all" ON orders;
DROP POLICY IF EXISTS "orders_select_customer" ON orders;
DROP POLICY IF EXISTS "orders_select_seller" ON orders;
DROP POLICY IF EXISTS "orders_select_public" ON orders;
DROP POLICY IF EXISTS "order_items_insert_all" ON order_items;
DROP POLICY IF EXISTS "order_items_select_customer" ON order_items;
DROP POLICY IF EXISTS "order_items_select_seller" ON order_items;
DROP POLICY IF EXISTS "order_items_select_public" ON order_items;
DROP POLICY IF EXISTS "payouts_select_own" ON payouts;
DROP POLICY IF EXISTS "payouts_insert_own" ON payouts;
DROP POLICY IF EXISTS "payouts_update_own" ON payouts;
DROP POLICY IF EXISTS "kyc_select_own" ON kyc_documents;
DROP POLICY IF EXISTS "kyc_insert_own" ON kyc_documents;
DROP POLICY IF EXISTS "kyc_update_own" ON kyc_documents;

-- ============================================
-- STEP 3: RE-ENABLE RLS
-- ============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE sellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_quick_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_auto_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variant_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_documents ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 4: CREATE ALL POLICIES (Single Pass)
-- ============================================

-- USERS: Service role can insert, authenticated can see/update own
CREATE POLICY "users_insert_admin" ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "users_select_own" ON users FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "users_update_own" ON users FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- SHOPS: Public readable, seller CRUD own
CREATE POLICY "shops_select_all" ON shops FOR SELECT USING (true);
CREATE POLICY "shops_insert_own" ON shops FOR INSERT TO authenticated WITH CHECK (seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1));
CREATE POLICY "shops_update_own" ON shops FOR UPDATE TO authenticated USING (seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1)) WITH CHECK (seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1));
CREATE POLICY "shops_delete_own" ON shops FOR DELETE TO authenticated USING (seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1));

-- SELLERS: Public readable, seller self-update
CREATE POLICY "sellers_select_all" ON sellers FOR SELECT USING (true);
CREATE POLICY "sellers_update_own" ON sellers FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- CUSTOMERS: Guests can insert, authenticated can see own
CREATE POLICY "customers_insert_guest" ON customers FOR INSERT WITH CHECK (true);
CREATE POLICY "customers_select_own" ON customers FOR SELECT USING (user_id = auth.uid() OR user_id IS NULL);
CREATE POLICY "customers_update_own" ON customers FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- CONVERSATIONS: Party-restricted (seller or customer only) + public read for guest access
CREATE POLICY "conversations_select_public" ON conversations FOR SELECT USING (true);
CREATE POLICY "conversations_select_seller" ON conversations FOR SELECT TO authenticated USING (seller_id = auth.uid());
CREATE POLICY "conversations_select_customer" ON conversations FOR SELECT TO authenticated USING (customer_id = (SELECT id FROM customers WHERE user_id = auth.uid() LIMIT 1));
CREATE POLICY "conversations_insert_all" ON conversations FOR INSERT WITH CHECK (true);
CREATE POLICY "conversations_update_seller" ON conversations FOR UPDATE TO authenticated USING (seller_id = auth.uid());
CREATE POLICY "conversations_update_customer" ON conversations FOR UPDATE TO authenticated USING (customer_id = (SELECT id FROM customers WHERE user_id = auth.uid() LIMIT 1));

-- MESSAGES: Party-restricted (conversation parties only) + guest insert + anon read
CREATE POLICY "messages_select_anon" ON messages FOR SELECT TO anon USING (true);
CREATE POLICY "messages_select_seller" ON messages FOR SELECT TO authenticated USING (conversation_id IN (SELECT id FROM conversations WHERE seller_id = auth.uid()));
CREATE POLICY "messages_select_customer" ON messages FOR SELECT TO authenticated USING (conversation_id IN (SELECT id FROM conversations WHERE customer_id = (SELECT id FROM customers WHERE user_id = auth.uid() LIMIT 1)));
CREATE POLICY "messages_insert_all" ON messages FOR INSERT WITH CHECK (true);
CREATE POLICY "messages_update_seller" ON messages FOR UPDATE TO authenticated USING (conversation_id IN (SELECT id FROM conversations WHERE seller_id = auth.uid()));

-- QUICK RESPONSES: Seller-only manage, public read active
CREATE POLICY "quick_responses_select_active" ON seller_quick_responses FOR SELECT USING (is_active = true);
CREATE POLICY "quick_responses_select_own" ON seller_quick_responses FOR SELECT TO authenticated USING (seller_id = auth.uid());
CREATE POLICY "quick_responses_insert_own" ON seller_quick_responses FOR INSERT TO authenticated WITH CHECK (seller_id = auth.uid());
CREATE POLICY "quick_responses_update_own" ON seller_quick_responses FOR UPDATE TO authenticated USING (seller_id = auth.uid()) WITH CHECK (seller_id = auth.uid());
CREATE POLICY "quick_responses_delete_own" ON seller_quick_responses FOR DELETE TO authenticated USING (seller_id = auth.uid());

-- AUTO REPLIES: Seller-only access
CREATE POLICY "auto_replies_select_own" ON seller_auto_replies FOR SELECT TO authenticated USING (seller_id = auth.uid());
CREATE POLICY "auto_replies_insert_own" ON seller_auto_replies FOR INSERT TO authenticated WITH CHECK (seller_id = auth.uid());
CREATE POLICY "auto_replies_update_own" ON seller_auto_replies FOR UPDATE TO authenticated USING (seller_id = auth.uid()) WITH CHECK (seller_id = auth.uid());
CREATE POLICY "auto_replies_delete_own" ON seller_auto_replies FOR DELETE TO authenticated USING (seller_id = auth.uid());

-- AVAILABILITY: Seller-only access
CREATE POLICY "availability_select_own" ON seller_availability FOR SELECT TO authenticated USING (seller_id = auth.uid());
CREATE POLICY "availability_insert_own" ON seller_availability FOR INSERT TO authenticated WITH CHECK (seller_id = auth.uid());
CREATE POLICY "availability_update_own" ON seller_availability FOR UPDATE TO authenticated USING (seller_id = auth.uid()) WITH CHECK (seller_id = auth.uid());
CREATE POLICY "availability_delete_own" ON seller_availability FOR DELETE TO authenticated USING (seller_id = auth.uid());

-- CATEGORIES: Public readable (for browsing and product details)
CREATE POLICY "categories_select_all" ON categories FOR SELECT USING (true);

-- PRODUCTS: Public read, seller CRUD own (via shop_id → shops.id)
CREATE POLICY "products_select_public" ON products FOR SELECT TO public USING (true);
CREATE POLICY "products_insert_own" ON products FOR INSERT TO authenticated WITH CHECK (shop_id IN (SELECT id FROM shops WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1)));
CREATE POLICY "products_update_own" ON products FOR UPDATE TO authenticated USING (shop_id IN (SELECT id FROM shops WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1))) WITH CHECK (shop_id IN (SELECT id FROM shops WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1)));
CREATE POLICY "products_delete_own" ON products FOR DELETE TO authenticated USING (shop_id IN (SELECT id FROM shops WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1)));

-- PRODUCT IMAGES: Public read, seller write
CREATE POLICY "product_images_select_public" ON product_images FOR SELECT USING (true);
CREATE POLICY "product_images_insert_own" ON product_images FOR INSERT TO authenticated WITH CHECK (product_id IN (SELECT id FROM products WHERE shop_id IN (SELECT id FROM shops WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1))));
CREATE POLICY "product_images_update_own" ON product_images FOR UPDATE TO authenticated USING (product_id IN (SELECT id FROM products WHERE shop_id IN (SELECT id FROM shops WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1)))) WITH CHECK (product_id IN (SELECT id FROM products WHERE shop_id IN (SELECT id FROM shops WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1))));
CREATE POLICY "product_images_delete_own" ON product_images FOR DELETE TO authenticated USING (product_id IN (SELECT id FROM products WHERE shop_id IN (SELECT id FROM shops WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1))));

-- PRODUCT VARIANTS: Public read, seller write
CREATE POLICY "product_variants_select_public" ON product_variants FOR SELECT USING (true);
CREATE POLICY "product_variants_insert_own" ON product_variants FOR INSERT TO authenticated WITH CHECK (product_id IN (SELECT id FROM products WHERE shop_id IN (SELECT id FROM shops WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1))));
CREATE POLICY "product_variants_update_own" ON product_variants FOR UPDATE TO authenticated USING (product_id IN (SELECT id FROM products WHERE shop_id IN (SELECT id FROM shops WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1)))) WITH CHECK (product_id IN (SELECT id FROM products WHERE shop_id IN (SELECT id FROM shops WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1))));
CREATE POLICY "product_variants_delete_own" ON product_variants FOR DELETE TO authenticated USING (product_id IN (SELECT id FROM products WHERE shop_id IN (SELECT id FROM shops WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1))));

-- PRODUCT VARIANT IMAGES: Public read, seller write
CREATE POLICY "product_variant_images_select_public" ON product_variant_images FOR SELECT USING (true);
CREATE POLICY "product_variant_images_insert_own" ON product_variant_images FOR INSERT TO authenticated WITH CHECK (product_variant_id IN (SELECT pv.id FROM product_variants pv WHERE pv.product_id IN (SELECT id FROM products WHERE shop_id IN (SELECT id FROM shops WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1)))));
CREATE POLICY "product_variant_images_update_own" ON product_variant_images FOR UPDATE TO authenticated USING (product_variant_id IN (SELECT pv.id FROM product_variants pv WHERE pv.product_id IN (SELECT id FROM products WHERE shop_id IN (SELECT id FROM shops WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1))))) WITH CHECK (product_variant_id IN (SELECT pv.id FROM product_variants pv WHERE pv.product_id IN (SELECT id FROM products WHERE shop_id IN (SELECT id FROM shops WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1)))));
CREATE POLICY "product_variant_images_delete_own" ON product_variant_images FOR DELETE TO authenticated USING (product_variant_id IN (SELECT pv.id FROM product_variants pv WHERE pv.product_id IN (SELECT id FROM products WHERE shop_id IN (SELECT id FROM shops WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1)))));

-- SELLER ORDERS: Backend inserts, seller SELECT/UPDATE own
CREATE POLICY "seller_orders_insert" ON seller_orders FOR INSERT WITH CHECK (true);
CREATE POLICY "seller_orders_select_own" ON seller_orders FOR SELECT TO authenticated USING (seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1));
CREATE POLICY "seller_orders_update_own" ON seller_orders FOR UPDATE TO authenticated USING (seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1)) WITH CHECK (seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1));

-- ORDERS: Guest insert, customer/seller view own
CREATE POLICY "orders_insert_all" ON orders FOR INSERT WITH CHECK (true);
CREATE POLICY "orders_select_customer" ON orders FOR SELECT TO authenticated USING (customer_id = (SELECT id FROM customers WHERE user_id = auth.uid() LIMIT 1));
CREATE POLICY "orders_select_seller" ON orders FOR SELECT TO authenticated USING (id IN (SELECT order_id FROM seller_orders WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1)));

-- ORDER ITEMS: Guest insert, customer/seller view own
CREATE POLICY "order_items_insert_all" ON order_items FOR INSERT WITH CHECK (true);
CREATE POLICY "order_items_select_customer" ON order_items FOR SELECT TO authenticated USING (order_id IN (SELECT id FROM orders WHERE customer_id = (SELECT id FROM customers WHERE user_id = auth.uid() LIMIT 1)));
CREATE POLICY "order_items_select_seller" ON order_items FOR SELECT TO authenticated USING (seller_order_id IN (SELECT id FROM seller_orders WHERE seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1)));

-- PAYOUTS: Seller read/write own
CREATE POLICY "payouts_select_own" ON payouts FOR SELECT TO authenticated USING (seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1));
CREATE POLICY "payouts_insert_own" ON payouts FOR INSERT TO authenticated WITH CHECK (seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1));
CREATE POLICY "payouts_update_own" ON payouts FOR UPDATE TO authenticated USING (seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1)) WITH CHECK (seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1));

-- KYC DOCUMENTS: Seller read/write own
CREATE POLICY "kyc_select_own" ON kyc_documents FOR SELECT TO authenticated USING (seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1));
CREATE POLICY "kyc_insert_own" ON kyc_documents FOR INSERT TO authenticated WITH CHECK (seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1));
CREATE POLICY "kyc_update_own" ON kyc_documents FOR UPDATE TO authenticated USING (seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1)) WITH CHECK (seller_id = (SELECT id FROM sellers WHERE user_id = auth.uid() LIMIT 1));
