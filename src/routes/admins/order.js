const express = require('express');
const { supabase } = require('../../db/supabase');
const router = express.Router();
const { authenticateAdmin, requireRole } = require('../../middlewares/adminAuthMiddleware');
const { decryptFile } = require('../../utils/encryption');
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const generateDeliveryCode = () => String(Math.floor(100000 + Math.random() * 900000));

// GET all orders with filtering
// GET /api/admin/orders?status=pending&search=order123
router.get('/admin/orders', authenticateAdmin, async (req, res) => {
    try {
        const { status, search, limit = 20, offset = 0 } = req.query;
        const parsedLimit = Number.parseInt(limit, 10);
        const parsedOffset = Number.parseInt(offset, 10);
        const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 20) : 20;
        const safeOffset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

        let query = supabase
            .from('orders')
            .select(`
                id,
                order_number,
                customer_name,
                customer_email,
                customer_phone,
                total_amount,
                status,
                payment_method,
                created_at,
                updated_at,
                manual_payment_reference,
                manual_payment_sender_phone,
                manual_payment_submitted_at,
                seller_orders(
                    id,
                    seller_id,
                    shop_id,
                    status,
                    items_subtotal,
                    delivery_fee,
                    total_amount,
                    shops(id, name, seller_id, sellers(id, first_name, last_name))
                )
            `, { count: 'exact' })
            .order('created_at', { ascending: false });

        // Filter by status if provided
        if (status && ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'].includes(status)) {
            query = query.eq('status', status);
        }

        // Search by order number or customer name/email
        if (search) {
            const searchTerm = `%${search}%`;
            query = query.or(`order_number.ilike.${searchTerm},customer_name.ilike.${searchTerm},customer_email.ilike.${searchTerm}`);
        }

        // Pagination
        query = query.range(safeOffset, safeOffset + safeLimit - 1);

        const { data: orders, error, count } = await query;

        if (error) {
            console.error('Error fetching orders:', error);
            return res.status(500).json({ 
                message: 'Error retrieving orders',
                error: error.message 
            });
        }

        return res.status(200)
            .set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
            .json({
                success: true,
                count: orders.length,
                total: count,
                pagination: {
                    limit: safeLimit,
                    offset: safeOffset,
                    total: count
                },
                data: orders
            });

    } catch (error) {
        console.error('Error in orders fetch:', error.message);
        return res.status(500).json({ message: 'An error occurred while fetching orders' });
    }
});

// GET single order details
// GET /api/admin/orders/:orderId
router.get('/admin/orders/:orderId', authenticateAdmin, async (req, res) => {
    try {
        const { orderId } = req.params;
        console.log('📍 Order detail request for ID:', orderId);

        if (!UUID_REGEX.test(orderId)) {
            console.error('❌ Invalid order ID format:', orderId);
            return res.status(400).json({
                success: false,
                message: 'Invalid order ID format'
            });
        }

        console.log('📍 Fetching order from database...');
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select(`
                id,
                order_number,
                customer_name,
                customer_email,
                customer_phone,
                department_id,
                arrondissement_id,
                commune_id,
                neighborhood,
                landmark,
                total_amount,
                payment_method,
                manual_payment_reference,
                manual_payment_sender_phone,
                manual_payment_submitted_at,
                manual_payment_proof_path,
                status,
                created_at,
                updated_at,
                seller_orders(
                    id,
                    seller_id,
                    shop_id,
                    delivery_method,
                    items_subtotal,
                    delivery_fee,
                    total_amount,
                    status,
                    confirmed_at,
                    shipped_at,
                    delivered_at,
                    shops(id, name, logo_url, sellers(id, first_name, last_name, email)),
                    order_items(
                        id,
                        product_id,
                        product_variant_id,
                        quantity,
                        unit_price,
                        total_price,
                        products(id, name, product_images(id, image_url, is_main)),
                        product_variants(id, sku, size, color, attributes, product_variant_images(id, image_url, is_main))
                    )
                )
            `)
            .eq('id', orderId)
            .single();

        if (orderError) {
            console.error('❌ Database error:', orderError.message);
            return res.status(404).json({
                success: false,
                message: 'Order not found',
                error: orderError.message
            });
        }

        if (!order) {
            console.error('❌ No order found with ID:', orderId);
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        console.log('✅ Order fetched successfully');
        console.log('📍 Order keys:', Object.keys(order));
        console.log('📍 Seller orders count:', order.seller_orders?.length ?? 0);
        if (order.seller_orders && order.seller_orders.length > 0) {
            console.log('📍 First seller order items count:', order.seller_orders[0].order_items?.length ?? 0);
            console.log('📍 Seller order structure:', JSON.stringify(order.seller_orders[0], null, 2));
        }

        return res.status(200)
            .set('Cache-Control', 'no-store, no-cache, must-revalidate')
            .json({
                success: true,
                data: order
            });

    } catch (error) {
        console.error('❌ Error fetching order details:', error.message);
        console.error('❌ Stack trace:', error.stack);
        return res.status(500).json({ message: 'An error occurred while fetching order details', error: error.message });
    }
});

// GET payment proof image (decrypt and serve)
// GET /api/admin/orders/:orderId/payment-proof
router.get('/admin/orders/:orderId/payment-proof',
    authenticateAdmin,
    requireRole(['CEO', 'Manager', 'Admin']),
    async (req, res) => {
        try {
            const { orderId } = req.params;

            if (!UUID_REGEX.test(orderId)) {
                return res.status(400).json({ message: 'Invalid order ID format' });
            }

            const { data: order, error: orderError } = await supabase
                .from('orders')
                .select('id, payment_method, manual_payment_proof_path, manual_payment_proof_iv, manual_payment_proof_auth_tag')
                .eq('id', orderId)
                .single();

            if (orderError || !order) {
                return res.status(404).json({ message: 'Order not found' });
            }

            if (order.payment_method !== 'manual' || !order.manual_payment_proof_path) {
                return res.status(400).json({ message: 'No payment proof available for this order' });
            }

            const filePath = order.manual_payment_proof_path;
            const iv = order.manual_payment_proof_iv;
            const authTag = order.manual_payment_proof_auth_tag;

            if (!filePath || !iv || !authTag) {
                return res.status(400).json({ message: 'Payment proof metadata incomplete' });
            }

            // Download encrypted file from Supabase storage
            const { data: encryptedData, error: downloadError } = await supabase.storage
                .from('customer_payment_proof')
                .download(filePath);

            if (downloadError) {
                console.error('Download error:', downloadError);
                return res.status(500).json({ message: 'Error downloading payment proof' });
            }

            // Convert blob to buffer
            const encryptedBuffer = Buffer.from(await encryptedData.arrayBuffer());

            // Decrypt the file
            const decryptedBuffer = decryptFile(encryptedBuffer, iv, authTag);

            // Send decrypted image
            res.set('Content-Type', 'image/webp');
            res.set('Content-Disposition', `inline; filename="payment-proof.webp"`);
            res.send(decryptedBuffer);

        } catch (error) {
            console.error('Error serving payment proof:', error);
            return res.status(500).json({ message: 'Error retrieving payment proof' });
        }
    }
);

// PUT verify manual payment
// PUT /api/admin/orders/:orderId/verify-payment
router.put('/admin/orders/:orderId/verify-payment',
    authenticateAdmin,
    requireRole(['CEO', 'Manager', 'Admin']),
    async (req, res) => {
        try {
            const { orderId } = req.params;
            const { approved, rejection_reason } = req.body;

            if (!UUID_REGEX.test(orderId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid order ID format'
                });
            }

            if (typeof approved !== 'boolean') {
                return res.status(400).json({
                    success: false,
                    message: 'Approved field must be a boolean'
                });
            }

            if (!approved && (!rejection_reason || !rejection_reason.trim())) {
                return res.status(400).json({
                    success: false,
                    message: 'Rejection reason is required when rejecting payment'
                });
            }

            const { data: order, error: orderError } = await supabase
                .from('orders')
                .select('id, payment_method, status, manual_payment_verified_at, manual_payment_rejection_reason')
                .eq('id', orderId)
                .single();

            if (orderError || !order) {
                return res.status(404).json({
                    success: false,
                    message: 'Order not found'
                });
            }

            if (order.payment_method !== 'manual') {
                return res.status(400).json({
                    success: false,
                    message: 'This order does not use manual payment method'
                });
            }

            if (order.manual_payment_verified_at) {
                return res.status(409).json({
                    success: false,
                    message: 'Payment for this order has already been verified'
                });
            }

            const updatePayload = approved
                ? {
                    manual_payment_verified_at: new Date().toISOString(),
                    manual_payment_verified_by: req.admin.id,
                    manual_payment_rejection_reason: null,
                    status: 'paid'
                }
                : {
                    manual_payment_rejection_reason: rejection_reason.trim(),
                    manual_payment_rejected_at: new Date().toISOString(),
                    manual_payment_rejected_by: req.admin.id,
                    status: 'cancelled'
                };

            const { data: updatedOrder, error: updateError } = await supabase
                .from('orders')
                .update(updatePayload)
                .eq('id', orderId)
                .select()
                .single();

            if (updateError) {
                console.error('Error updating order:', updateError);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to verify payment'
                });
            }

            // Generate delivery codes for seller orders when payment is approved
            if (approved) {
                const { data: sellerOrders, error: sellerOrdersError } = await supabase
                    .from('seller_orders')
                    .select('id, delivery_code_full')
                    .eq('order_id', orderId);

                if (!sellerOrdersError && sellerOrders && sellerOrders.length > 0) {
                    for (const sellerOrder of sellerOrders) {
                        // Skip if already has delivery code
                        if (sellerOrder.delivery_code_full) {
                            continue;
                        }

                        const code = generateDeliveryCode();

                        await supabase
                            .from('seller_orders')
                            .update({
                                delivery_code_full: code,
                                delivery_code_attempts: 0,
                                updated_at: new Date().toISOString()
                            })
                            .eq('id', sellerOrder.id);
                    }
                }
            }

            return res.status(200).json({
                success: true,
                message: approved ? 'Payment verified successfully' : 'Payment rejected successfully',
                data: {
                    orderId,
                    approved,
                    verifiedAt: approved ? new Date().toISOString() : null,
                    rejectionReason: approved ? null : rejection_reason.trim(),
                    status: updatedOrder.status,
                    verifiedBy: req.admin.id
                }
            });

        } catch (error) {
            console.error('Error verifying payment:', error.message);
            return res.status(500).json({
                success: false,
                message: 'An error occurred while verifying payment'
            });
        }
    }
);

// PUT update order status (admin can cancel orders)
// PUT /api/admin/orders/:orderId/status
router.put('/admin/orders/:orderId/status',
    authenticateAdmin,
    requireRole(['CEO', 'Manager', 'Admin']),
    async (req, res) => {
        try {
            const { orderId } = req.params;
            const { status, reason } = req.body;

            if (!UUID_REGEX.test(orderId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid order ID format'
                });
            }

            if (!status || !['cancelled'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Only cancellation is allowed by admin'
                });
            }

            const { data: order, error: orderError } = await supabase
                .from('orders')
                .select('id, status')
                .eq('id', orderId)
                .single();

            if (orderError || !order) {
                return res.status(404).json({
                    success: false,
                    message: 'Order not found'
                });
            }

            if (order.status === 'delivered') {
                return res.status(409).json({
                    success: false,
                    message: 'Cannot cancel a delivered order'
                });
            }

            const { error: updateError } = await supabase
                .from('orders')
                .update({
                    status: 'cancelled',
                    cancelled_at: new Date().toISOString(),
                    cancellation_reason: reason || null,
                    cancelled_by_admin: true
                })
                .eq('id', orderId);

            if (updateError) {
                console.error('Error cancelling order:', updateError);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to cancel order'
                });
            }

            // Also cancel all related seller_orders
            await supabase
                .from('seller_orders')
                .update({ status: 'cancelled' })
                .eq('order_id', orderId);

            return res.status(200).json({
                success: true,
                message: 'Order cancelled successfully',
                data: {
                    orderId,
                    status: 'cancelled',
                    cancelledAt: new Date().toISOString(),
                    cancelledBy: req.admin.id
                }
            });

        } catch (error) {
            console.error('Error cancelling order:', error.message);
            return res.status(500).json({
                success: false,
                message: 'An error occurred while cancelling the order'
            });
        }
    }
);

module.exports = router;