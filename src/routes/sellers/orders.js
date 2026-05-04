const express = require('express');
const router = express.Router();
const authenticateUser = require('../../middlewares/authMiddleware');
const { supabase, supabaseAdmin } = require('../../db/supabase');
const { sellerStoreLimiter } = require('../../middlewares/limit');
const { sendCustomerOrderStatusEmail, sendSellerOrderPaidEmail, sendCustomerOrderPaidEmail, sendSellerCancelledToCustomer, sendSellerCancelledToSeller } = require('../../email/notifications/lifecycleNotifications');
const { decryptFile } = require('../../utils/encryption');

const generateDeliveryCode = () => String(Math.floor(100000 + Math.random() * 900000));

const verifyCodeMatch = (inputCode, storedCode) => inputCode === storedCode;

const notifyCustomerOrderStatusUpdate = async ({ orderId, status, sellerId }) => {
    const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('order_number, customer_name, customer_email')
        .eq('id', orderId)
        .maybeSingle();

    if (orderError || !order?.customer_email) {
        if (orderError) {
            console.error('Error fetching order for status notification:', orderError);
        }
        return;
    }

    let sellerName = 'Vendeur';
    if (sellerId) {
        const { data: seller, error: sellerError } = await supabase
            .from('sellers')
            .select('first_name, last_name')
            .eq('id', sellerId)
            .maybeSingle();

        if (!sellerError && seller) {
            sellerName = `${seller.first_name || ''} ${seller.last_name || ''}`.trim() || 'Vendeur';
        }
    }

    try {
        await sendCustomerOrderStatusEmail({
            toEmail: order.customer_email,
            customerName: order.customer_name,
            orderNumber: order.order_number,
            status,
            sellerName
        });
    } catch (error) {
        console.error('Error sending customer status email:', error.message);
    }
};

// GET seller's orders
router.get('/', authenticateUser, sellerStoreLimiter, async (req, res) => {
    try {
        const user = req.user;
        const { status, limit = 20, offset = 0 } = req.query;

        const { data: seller, error: sellerError } = await supabase
            .from('sellers')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (sellerError) {
            console.error('Error fetching seller:', sellerError);
            return res.status(500).json({ message: 'Error verifying seller' });
        }

        if (!seller) {
            return res.status(404).json({ message: 'Seller not found' });
        }

        let query = supabase
            .from('seller_orders')
            .select('id, order_id, seller_id, shop_id, items_subtotal, delivery_fee, total_amount, status, confirmed_at, shipped_at, delivered_at, created_at', { count: 'exact' })
            .eq('seller_id', seller.id)
            .order('created_at', { ascending: false });

        if (status && ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'].includes(status)) {
            query = query.eq('status', status);
        }

        query = query.range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        const { data: sellerOrders, error: sellerOrdersError, count } = await query;

        if (sellerOrdersError) {
            console.error('Error fetching seller orders:', sellerOrdersError);
            return res.status(500).json({ message: 'Error fetching seller orders' });
        }

        const sellerOrderIds = (sellerOrders || []).map(so => so.id);
        let orderDetails = {};

        if (sellerOrderIds.length > 0) {
            const { data: orders, error: ordersError } = await supabase
                .from('orders')
                .select('id, order_number, customer_name, customer_email, customer_phone, total_amount, status, payment_method, manual_payment_reference, manual_payment_sender_phone, manual_payment_screenshot_name, manual_payment_submitted_at, created_at, department_id, arrondissement_id, commune_id, neighborhood, landmark')
                .in('id', (sellerOrders || []).map(so => so.order_id));

            if (ordersError) {
                console.error('Error fetching orders:', ordersError);
                return res.status(500).json({ message: 'Error fetching orders' });
            }

            orders.forEach(order => {
                orderDetails[order.id] = order;
            });

            const { data: items, error: itemsError } = await supabase
                .from('order_items')
                .select('id, seller_order_id, product_id, product_variant_id, quantity, unit_price, total_price')
                .in('seller_order_id', sellerOrderIds);

            if (itemsError) {
                console.error('Error fetching order items:', itemsError);
                return res.status(500).json({ message: 'Error fetching order items' });
            }

            // Fetch product and variant data with images
            const productIds = [...new Set((items || []).map(item => item.product_id))];
            const variantIds = [...new Set((items || []).filter(item => item.product_variant_id).map(item => item.product_variant_id))];

            let products = [];
            let variants = [];
            let productImageMap = new Map();
            let variantImageMap = new Map();

            if (productIds.length > 0) {
                const { data: productsData, error: productsError } = await supabase
                    .from('products')
                    .select('id, name')
                    .in('id', productIds);

                if (productsError) {
                    console.error('Error fetching products:', productsError);
                } else {
                    products = productsData || [];
                }

                // Fetch product images
                const { data: productImages, error: productImagesError } = await supabase
                    .from('product_images')
                    .select('product_id, image_url, position, is_main')
                    .in('product_id', productIds);

                if (!productImagesError && productImages) {
                    productImages.forEach(image => {
                        const existing = productImageMap.get(image.product_id);
                        if (!existing || image.is_main || image.position < existing.position) {
                            productImageMap.set(image.product_id, image.image_url);
                        }
                    });
                }
            }

            if (variantIds.length > 0) {
                const { data: variantsData, error: variantsError } = await supabase
                    .from('product_variants')
                    .select('id, product_id, size, color, sku')
                    .in('id', variantIds);

                if (variantsError) {
                    console.error('Error fetching variants:', variantsError);
                } else {
                    variants = variantsData || [];
                }

                // Fetch variant images
                const { data: variantImages, error: variantImagesError } = await supabase
                    .from('product_variant_images')
                    .select('product_variant_id, image_url, position, is_main')
                    .in('product_variant_id', variantIds);

                if (!variantImagesError && variantImages) {
                    variantImages.forEach(image => {
                        const existing = variantImageMap.get(image.product_variant_id);
                        if (!existing || image.is_main || image.position < existing.position) {
                            variantImageMap.set(image.product_variant_id, image.image_url);
                        }
                    });
                }
            }

            const productMap = new Map(products.map(p => [p.id, p]));
            const variantMap = new Map(variants.map(v => [v.id, v]));

            const itemsBySellerOrderId = new Map();
            (items || []).forEach(item => {
                if (!itemsBySellerOrderId.has(item.seller_order_id)) {
                    itemsBySellerOrderId.set(item.seller_order_id, []);
                }

                const product = productMap.get(item.product_id);
                const variant = item.product_variant_id ? variantMap.get(item.product_variant_id) : null;
                const variantImage = item.product_variant_id ? variantImageMap.get(item.product_variant_id) : null;
                const productImage = variantImage || productImageMap.get(item.product_id) || '';

                const enrichedItem = {
                    ...item,
                    product_name: product?.name || 'Produit',
                    product_image: productImage,
                    variant_label: variant ? [
                        variant.size && `Taille: ${variant.size}`,
                        variant.color && `Couleur: ${variant.color}`
                    ].filter(Boolean).join(' • ') : ''
                };

                itemsBySellerOrderId.get(item.seller_order_id).push(enrichedItem);
            });

            const result = (sellerOrders || []).map(so => ({
                ...so,
                order: orderDetails[so.order_id],
                items: itemsBySellerOrderId.get(so.id) || []
            }));

            return res.status(200).json({
                message: 'Commandes du vendeur récupérées',
                data: result,
                pagination: {
                    total: count,
                    limit: parseInt(limit),
                    offset: parseInt(offset)
                }
            });
        }

        return res.status(200).json({
            message: 'Seller orders retrieved',
            data: [],
            pagination: {
                total: 0,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (error) {
        console.error('Get seller orders error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// GET seller earnings history (delivered orders)
// GET /seller/orders/earnings
router.get('/earnings', authenticateUser, sellerStoreLimiter, async (req, res) => {
    try {
        const user = req.user;

        const { data: seller, error: sellerError } = await supabase
            .from('sellers')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (sellerError || !seller) {
            return res.status(404).json({ message: 'Seller not found' });
        }

        const sellerId = seller.id;

        // Fetch last 50 delivered seller_orders
        const { data: sellerOrders, error: ordersError } = await supabase
            .from('seller_orders')
            .select('id, order_id, items_subtotal, delivery_fee, total_amount, delivered_at')
            .eq('seller_id', sellerId)
            .eq('status', 'delivered')
            .order('delivered_at', { ascending: false })
            .limit(50);

        if (ordersError) {
            console.error('Earnings fetch error:', ordersError);
            return res.status(500).json({ message: 'Error fetching earnings' });
        }

        const orders = sellerOrders || [];

        // Resolve order_number from parent orders table
        const orderIds = orders.map(o => o.order_id);
        const orderNumberMap = {};
        if (orderIds.length > 0) {
            const { data: parentOrders } = await supabase
                .from('orders')
                .select('id, order_number')
                .in('id', orderIds);
            (parentOrders || []).forEach(o => { orderNumberMap[o.id] = o.order_number; });
        }

        const earnings = orders.map(o => ({
            id: o.id,
            order_number: orderNumberMap[o.order_id] ?? 'N/A',
            items_subtotal: Number(o.items_subtotal),
            delivery_fee: Number(o.delivery_fee),
            total_amount: Number(o.total_amount),
            delivered_at: o.delivered_at,
        }));

        // Total earned across ALL delivered orders (not just last 50)
        const { data: allDelivered } = await supabase
            .from('seller_orders')
            .select('total_amount')
            .eq('seller_id', sellerId)
            .eq('status', 'delivered');

        const total_earned = (allDelivered || []).reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

        return res.json({ success: true, total_earned, earnings });
    } catch (error) {
        console.error('Seller earnings error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// GET seller dashboard stats
// GET /seller/orders/stats
router.get('/stats', authenticateUser, sellerStoreLimiter, async (req, res) => {
    try {
        const user = req.user;

        const { data: seller, error: sellerError } = await supabase
            .from('sellers')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (sellerError || !seller) {
            return res.status(404).json({ message: 'Seller not found' });
        }

        const sellerId = seller.id;

        // Fetch all seller_orders for this seller (lightweight)
        const { data: allOrders, error: ordersError } = await supabase
            .from('seller_orders')
            .select('id, total_amount, items_subtotal, status, created_at, shop_id')
            .eq('seller_id', sellerId);

        if (ordersError) {
            console.error('Stats orders error:', ordersError);
            return res.status(500).json({ message: 'Error fetching orders' });
        }

        const orders = allOrders || [];

        // Date boundaries
        const now = new Date();
        const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

        const totalOrders = orders.length;
        const pendingOrders = orders.filter(o => o.status === 'pending').length;

        const completedOrders = orders.filter(o => o.status === 'delivered');
        const totalRevenue = completedOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
        const averageOrderValue = completedOrders.length > 0
            ? totalRevenue / completedOrders.length
            : 0;

        const ordersThisMonth = orders.filter(o => new Date(o.created_at) >= startOfThisMonth).length;
        const ordersLastMonth = orders.filter(o => {
            const d = new Date(o.created_at);
            return d >= startOfLastMonth && d <= endOfLastMonth;
        }).length;

        // Top-selling products via seller_order_items
        const shopIds = [...new Set(orders.map(o => o.shop_id).filter(Boolean))];
        let topProducts = [];

        if (shopIds.length > 0) {
            const orderIds = orders.map(o => o.id);

            const { data: itemsData, error: itemsError } = await supabase
                .from('order_items')
                .select('product_id, quantity, unit_price')
                .in('seller_order_id', orderIds);

            if (!itemsError && itemsData && itemsData.length > 0) {
                // Aggregate by product
                const productTotals = {};
                for (const item of itemsData) {
                    if (!item.product_id) continue;
                    if (!productTotals[item.product_id]) {
                        productTotals[item.product_id] = { product_id: item.product_id, total_quantity: 0, total_revenue: 0 };
                    }
                    productTotals[item.product_id].total_quantity += Number(item.quantity) || 0;
                    productTotals[item.product_id].total_revenue += (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
                }

                const sorted = Object.values(productTotals)
                    .sort((a, b) => b.total_quantity - a.total_quantity)
                    .slice(0, 5);

                const productIds = sorted.map(p => p.product_id);
                const { data: productsData } = await supabase
                    .from('products')
                    .select('id, name, product_images(image_url, is_main)')
                    .in('id', productIds);

                const productsById = new Map((productsData || []).map(p => [p.id, p]));

                topProducts = sorted.map(p => {
                    const product = productsById.get(p.product_id);
                    const mainImg = product?.product_images?.find(i => i.is_main) ?? product?.product_images?.[0];
                    return {
                        product_id: p.product_id,
                        name: product?.name ?? 'Produit inconnu',
                        image_url: mainImg?.image_url ?? null,
                        total_quantity: p.total_quantity,
                        total_revenue: p.total_revenue,
                    };
                });
            }
        }

        // Unread messages count — conversations.seller_id = auth.users.id (not sellers.id)
        const { data: convData } = await supabase
            .from('conversations')
            .select('seller_unread_count')
            .eq('seller_id', user.id);

        const unreadMessages = (convData || []).reduce((sum, c) => sum + (Number(c.seller_unread_count) || 0), 0);

        return res.json({
            success: true,
            stats: {
                totalOrders,
                pendingOrders,
                totalRevenue,
                averageOrderValue,
                ordersThisMonth,
                ordersLastMonth,
                topProducts,
                unreadMessages: unreadMessages ?? 0,
            }
        });
    } catch (error) {
        console.error('Seller stats error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// GET payment proof image for a seller order
router.get('/:sellerOrderId/payment-proof', authenticateUser, sellerStoreLimiter, async (req, res) => {
    try {
        const user = req.user;
        const { sellerOrderId } = req.params;

        // Verify this seller order belongs to the authenticated seller
        const { data: seller, error: sellerError } = await supabase
            .from('sellers')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (sellerError || !seller) {
            return res.status(403).json({ message: 'Seller not found' });
        }

        const { data: sellerOrder, error: sellerOrderError } = await supabase
            .from('seller_orders')
            .select('id, seller_id, order_id')
            .eq('id', sellerOrderId)
            .eq('seller_id', seller.id)
            .maybeSingle();

        if (sellerOrderError || !sellerOrder) {
            return res.status(404).json({ message: 'Seller order not found' });
        }

        // Fetch payment proof fields from the orders table
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, payment_method, manual_payment_proof_path, manual_payment_proof_iv, manual_payment_proof_auth_tag')
            .eq('id', sellerOrder.order_id)
            .single();

        if (orderError || !order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        if (order.payment_method !== 'manual' || !order.manual_payment_proof_path) {
            return res.status(400).json({ message: 'No payment proof available for this order' });
        }

        const { manual_payment_proof_path: filePath, manual_payment_proof_iv: iv, manual_payment_proof_auth_tag: authTag } = order;

        if (!filePath || !iv || !authTag) {
            return res.status(400).json({ message: 'Payment proof metadata incomplete' });
        }

        const { data: encryptedData, error: downloadError } = await supabase.storage
            .from('customer_payment_proof')
            .download(filePath);

        if (downloadError) {
            console.error('Download error:', downloadError);
            return res.status(500).json({ message: 'Error downloading payment proof' });
        }

        const encryptedBuffer = Buffer.from(await encryptedData.arrayBuffer());
        const decryptedBuffer = decryptFile(encryptedBuffer, iv, authTag);

        res.set('Content-Type', 'image/webp');
        res.set('Content-Disposition', 'inline; filename="payment-proof.webp"');
        res.send(decryptedBuffer);

    } catch (error) {
        console.error('Error serving payment proof:', error);
        return res.status(500).json({ message: 'Error retrieving payment proof' });
    }
});

// PUT verify manual payment for a seller order
router.put('/:sellerOrderId/verify-payment', authenticateUser, sellerStoreLimiter, async (req, res) => {
    try {
        const user = req.user;
        const { sellerOrderId } = req.params;
        const { approved, rejection_reason } = req.body;

        if (typeof approved !== 'boolean') {
            return res.status(400).json({ success: false, message: 'Approved field must be a boolean' });
        }

        // Verify this seller order belongs to the authenticated seller
        const { data: seller, error: sellerError } = await supabase
            .from('sellers')
            .select('id, first_name, last_name, email')
            .eq('user_id', user.id)
            .maybeSingle();

        if (sellerError || !seller) {
            return res.status(403).json({ success: false, message: 'Seller not found' });
        }

        const { data: sellerOrder, error: sellerOrderError } = await supabase
            .from('seller_orders')
            .select('id, seller_id, order_id, total_amount, delivery_code_full')
            .eq('id', sellerOrderId)
            .eq('seller_id', seller.id)
            .maybeSingle();

        if (sellerOrderError || !sellerOrder) {
            return res.status(404).json({ success: false, message: 'Seller order not found' });
        }

        // Fetch the parent order
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, order_number, customer_name, customer_email, total_amount, payment_method, status, manual_payment_verified_at')
            .eq('id', sellerOrder.order_id)
            .single();

        if (orderError || !order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (order.payment_method !== 'manual') {
            return res.status(400).json({ success: false, message: 'This order does not use manual payment method' });
        }

        if (order.manual_payment_verified_at) {
            return res.status(409).json({ success: false, message: 'Payment for this order has already been verified' });
        }

        const now = new Date().toISOString();
        const updatePayload = approved
            ? {
                manual_payment_verified_at: now,
                manual_payment_verified_by: user.id,
                manual_payment_rejection_reason: null,
                status: 'paid'
            }
            : {
                manual_payment_rejection_reason: rejection_reason ? rejection_reason.trim() : null,
                manual_payment_rejected_at: now,
                manual_payment_rejected_by: user.id,
                status: 'cancelled'
            };

        const { data: updatedOrder, error: updateError } = await supabase
            .from('orders')
            .update(updatePayload)
            .eq('id', sellerOrder.order_id)
            .select()
            .single();

        if (updateError) {
            console.error('Error updating order:', updateError);
            return res.status(500).json({ success: false, message: 'Failed to verify payment' });
        }

        // On approval: generate delivery codes for all seller orders and send emails
        if (approved) {
            const { data: allSellerOrders, error: allSellerOrdersError } = await supabase
                .from('seller_orders')
                .select('id, seller_id, total_amount, delivery_code_full')
                .eq('order_id', sellerOrder.order_id);

            if (!allSellerOrdersError && allSellerOrders && allSellerOrders.length > 0) {
                for (const so of allSellerOrders) {
                    if (so.delivery_code_full) continue;
                    const code = generateDeliveryCode();
                    await supabase
                        .from('seller_orders')
                        .update({ delivery_code_full: code, delivery_code_attempts: 0, updated_at: now })
                        .eq('id', so.id);
                }

                const sellerIds = [...new Set(allSellerOrders.map(so => so.seller_id).filter(Boolean))];
                const { data: sellers } = await supabase
                    .from('sellers')
                    .select('id, first_name, last_name, email')
                    .in('id', sellerIds);

                const sellersById = new Map((sellers || []).map(s => [s.id, s]));

                await Promise.all(allSellerOrders.map(async (so) => {
                    const s = sellersById.get(so.seller_id);
                    if (!s?.email) return;
                    try {
                        await sendSellerOrderPaidEmail({
                            toEmail: s.email,
                            sellerName: `${s.first_name || ''} ${s.last_name || ''}`.trim() || 'Vendeur',
                            orderNumber: order.order_number,
                            sellerTotal: so.total_amount
                        });
                    } catch (emailError) {
                        console.error('Error sending paid email to seller:', emailError.message);
                    }
                }));
            }

            if (order.customer_email) {
                // Re-fetch all seller orders with updated codes and shop names for customer email
                const { data: sellerOrdersWithCodes } = await supabase
                    .from('seller_orders')
                    .select('delivery_code_full, shop:shops(name)')
                    .eq('order_id', sellerOrder.order_id)
                    .not('delivery_code_full', 'is', null);

                const deliveryCodes = (sellerOrdersWithCodes || []).map(so => ({
                    shopName: so.shop?.name || 'Boutique',
                    code: so.delivery_code_full
                }));

                try {
                    await sendCustomerOrderPaidEmail({
                        toEmail: order.customer_email,
                        customerName: order.customer_name,
                        orderNumber: order.order_number,
                        totalAmount: order.total_amount,
                        deliveryCodes
                    });
                } catch (emailError) {
                    console.error('Error sending paid email to customer:', emailError.message);
                }
            }
        }

        return res.status(200).json({
            success: true,
            message: approved ? 'Payment verified successfully' : 'Payment rejected successfully',
            data: {
                sellerOrderId,
                orderId: sellerOrder.order_id,
                approved,
                verifiedAt: approved ? now : null,
                rejectionReason: approved ? null : (rejection_reason ? rejection_reason.trim() : null),
                status: updatedOrder.status,
                verifiedBy: user.id
            }
        });

    } catch (error) {
        console.error('Error verifying payment:', error.message);
        return res.status(500).json({ success: false, message: 'An error occurred while verifying payment' });
    }
});

// GET single seller order
router.get('/:sellerOrderId', authenticateUser, async (req, res) => {
    try {
        const user = req.user;
        const { sellerOrderId } = req.params;

        const { data: seller, error: sellerError } = await supabase
            .from('sellers')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (sellerError) {
            console.error('Error fetching seller:', sellerError);
            return res.status(500).json({ message: 'Error verifying seller' });
        }

        if (!seller) {
            return res.status(404).json({ message: 'Seller not found' });
        }

        const { data: sellerOrder, error: sellerOrderError } = await supabase
            .from('seller_orders')
            .select('*')
            .eq('id', sellerOrderId)
            .eq('seller_id', seller.id)
            .maybeSingle();

        if (sellerOrderError) {
            console.error('Error fetching seller order:', sellerOrderError);
            return res.status(500).json({ message: 'Error fetching seller order' });
        }

        if (!sellerOrder) {
            return res.status(404).json({ message: 'Seller order not found' });
        }

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', sellerOrder.order_id)
            .maybeSingle();

        if (orderError) {
            console.error('Error fetching order:', orderError);
            return res.status(500).json({ message: 'Error fetching order' });
        }

        const { data: items, error: itemsError } = await supabase
            .from('order_items')
            .select('id, order_id, seller_order_id, product_id, product_variant_id, quantity, unit_price, total_price')
            .eq('seller_order_id', sellerOrderId);

        if (itemsError) {
            console.error('Error fetching order items:', itemsError);
            return res.status(500).json({ message: 'Error fetching order items' });
        }

        // Fetch product and variant data with images
        const productIds = [...new Set((items || []).map(item => item.product_id))];
        const variantIds = [...new Set((items || []).filter(item => item.product_variant_id).map(item => item.product_variant_id))];

        let products = [];
        let variants = [];
        let productImageMap = new Map();
        let variantImageMap = new Map();

        if (productIds.length > 0) {
            const { data: productsData, error: productsError } = await supabase
                .from('products')
                .select('id, name')
                .in('id', productIds);

            if (productsError) {
                console.error('Error fetching products:', productsError);
            } else {
                products = productsData || [];
            }

            // Fetch product images
            const { data: productImages, error: productImagesError } = await supabase
                .from('product_images')
                .select('product_id, image_url, position, is_main')
                .in('product_id', productIds);

            if (!productImagesError && productImages) {
                productImages.forEach(image => {
                    const existing = productImageMap.get(image.product_id);
                    if (!existing || image.is_main || image.position < existing.position) {
                        productImageMap.set(image.product_id, image.image_url);
                    }
                });
            }
        }

        if (variantIds.length > 0) {
            const { data: variantsData, error: variantsError } = await supabase
                .from('product_variants')
                .select('id, product_id, size, color, sku')
                .in('id', variantIds);

            if (variantsError) {
                console.error('Error fetching variants:', variantsError);
            } else {
                variants = variantsData || [];
            }

            // Fetch variant images
            const { data: variantImages, error: variantImagesError } = await supabase
                .from('product_variant_images')
                .select('product_variant_id, image_url, position, is_main')
                .in('product_variant_id', variantIds);

            if (!variantImagesError && variantImages) {
                variantImages.forEach(image => {
                    const existing = variantImageMap.get(image.product_variant_id);
                    if (!existing || image.is_main || image.position < existing.position) {
                        variantImageMap.set(image.product_variant_id, image.image_url);
                    }
                });
            }
        }

        const productMap = new Map(products.map(p => [p.id, p]));
        const variantMap = new Map(variants.map(v => [v.id, v]));

        const enrichedItems = (items || []).map(item => {
            const product = productMap.get(item.product_id);
            const variant = item.product_variant_id ? variantMap.get(item.product_variant_id) : null;
            const variantImage = item.product_variant_id ? variantImageMap.get(item.product_variant_id) : null;
            const productImage = variantImage || productImageMap.get(item.product_id) || '';

            return {
                ...item,
                product_name: product?.name || 'Produit',
                product_image: productImage,
                variant_label: variant ? [
                    variant.size && `Taille: ${variant.size}`,
                    variant.color && `Couleur: ${variant.color}`
                ].filter(Boolean).join(' • ') : ''
            };
        });

        return res.status(200).json({
            message: 'Commande du vendeur récupérée',
            data: {
                ...sellerOrder,
                order,
                items: enrichedItems
            }
        });
    } catch (error) {
        console.error('Get seller order detail error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// PATCH seller order status (update to shipped/delivered)
router.patch('/:sellerOrderId/status', authenticateUser, sellerStoreLimiter, async (req, res) => {
    try {
        const user = req.user;
        const { sellerOrderId } = req.params;
        const { status, cancelReason } = req.body;

        if (!status || !['confirmed', 'shipped', 'delivered', 'cancelled'].includes(status)) {
            return res.status(400).json({ message: 'Statut invalide. Doit être "confirmé", "expédié", "livré" ou "annulé"' });
        }

        const { data: seller, error: sellerError } = await supabase
            .from('sellers')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (sellerError) {
            console.error('Error fetching seller:', sellerError);
            return res.status(500).json({ message: 'Error verifying seller' });
        }

        if (!seller) {
            return res.status(404).json({ message: 'Seller not found' });
        }

        const { data: sellerOrder, error: sellerOrderError } = await supabase
            .from('seller_orders')
            .select('id, seller_id, shop_id, status, order_id, created_at')
            .eq('id', sellerOrderId)
            .eq('seller_id', seller.id)
            .maybeSingle();

        if (sellerOrderError) {
            console.error('Error fetching seller order:', sellerOrderError);
            return res.status(500).json({ message: 'Error fetching seller order' });
        }

        if (!sellerOrder) {
            return res.status(404).json({ message: 'Seller order not found' });
        }

        if (status === 'cancelled') {
            const { data: storePolicy, error: storePolicyError } = await supabaseAdmin
                .from('seller_store_policies')
                .select('id, cancellation_window_hours, is_published')
                .eq('seller_id', seller.id)
                .eq('shop_id', sellerOrder.shop_id)
                .eq('is_published', true)
                .maybeSingle();

            if (storePolicyError) {
                console.error('Error fetching seller policy for cancellation check:', storePolicyError);
                return res.status(500).json({ message: 'Error validating cancellation policy' });
            }

            if (storePolicy) {
                const cancellationWindowHours = Number(storePolicy.cancellation_window_hours || 0);
                const createdAtMs = new Date(sellerOrder.created_at).getTime();

                if (Number.isFinite(createdAtMs)) {
                    const elapsedMs = Date.now() - createdAtMs;
                    const allowedMs = cancellationWindowHours * 60 * 60 * 1000;

                    if (elapsedMs > allowedMs) {
                        return res.status(403).json({
                            message: `Le delai d annulation de ${cancellationWindowHours}h est depasse pour cette commande.`,
                        });
                    }
                }
            }
        }

        const validTransitions = {
            pending: ['confirmed', 'shipped', 'cancelled'],
            confirmed: ['shipped', 'cancelled'],
            shipped: ['delivered'],
            delivered: [],
            cancelled: []
        };

        if (!validTransitions[sellerOrder.status] || !validTransitions[sellerOrder.status].includes(status)) {
            return res.status(400).json({
                message: `Cannot transition from ${sellerOrder.status} to ${status}`,
                currentStatus: sellerOrder.status
            });
        }

        const updatePayload = {
            status,
            updated_at: new Date().toISOString()
        };

        if (status === 'confirmed') {
            updatePayload.confirmed_at = new Date().toISOString();
        } else if (status === 'shipped') {
            updatePayload.shipped_at = new Date().toISOString();
        } else if (status === 'delivered') {
            updatePayload.delivered_at = new Date().toISOString();
        }

        const { error: updateError } = await supabase
            .from('seller_orders')
            .update(updatePayload)
            .eq('id', sellerOrderId);

        if (updateError) {
            console.error('Error updating seller order:', updateError);
            return res.status(500).json({ message: 'Error updating seller order' });
        }

        const { error: logError } = await supabase
            .from('order_status_log')
            .insert([{
                seller_order_id: sellerOrderId,
                previous_status: sellerOrder.status,
                new_status: status,
                changed_by: 'seller',
                success: true
            }]);

        if (logError) {
            console.error('Error logging status update:', logError);
        }

        await notifyCustomerOrderStatusUpdate({
            orderId: sellerOrder.order_id,
            status,
            sellerId: seller.id
        });

        // Fire dedicated cancellation emails when seller cancels
        if (status === 'cancelled') {
            (async () => {
                try {
                    const cancelDate = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
                    const { data: parentOrder } = await supabase
                        .from('orders')
                        .select('customer_email, customer_name, order_number, total_amount')
                        .eq('id', sellerOrder.order_id)
                        .maybeSingle();
                    const { data: sellerInfo } = await supabase
                        .from('sellers')
                        .select('email, first_name, last_name')
                        .eq('id', seller.id)
                        .maybeSingle();

                    const sellerFullName = sellerInfo ? `${sellerInfo.first_name || ''} ${sellerInfo.last_name || ''}`.trim() || 'Vendeur' : 'Vendeur';

                    if (parentOrder) {
                        await sendSellerCancelledToCustomer({
                            toEmail: parentOrder.customer_email,
                            customerName: parentOrder.customer_name || 'Client',
                            sellerName: sellerFullName,
                            orderNumber: parentOrder.order_number,
                            orderId: sellerOrder.order_id,
                            cancelDate,
                            orderTotal: parentOrder.total_amount ?? 0,
                            cancelReason: cancelReason || null,
                        });
                    }
                    if (sellerInfo?.email) {
                        await sendSellerCancelledToSeller({
                            toEmail: sellerInfo.email,
                            sellerName: sellerFullName,
                            customerName: parentOrder?.customer_name || 'Client',
                            orderNumber: parentOrder?.order_number || sellerOrderId,
                            cancelDate,
                            orderTotal: parentOrder?.total_amount ?? 0,
                            cancelReason: cancelReason || null,
                        });
                    }
                } catch (emailErr) {
                    console.error('Error sending seller cancellation emails:', emailErr);
                }
            })();
        }

        return res.status(200).json({
            message: 'Statut de la commande du vendeur mis à jour',
            data: {
                sellerOrderId,
                status,
                updatedAt: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Update seller order status error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// POST confirm delivery with code
router.post('/:sellerOrderId/confirm-delivery', authenticateUser, sellerStoreLimiter, async (req, res) => {
    try {
        const user = req.user;
        const { sellerOrderId } = req.params;
        const { code } = req.body;

        if (!code || !/^\d{6}$/.test(code)) {
            return res.status(400).json({ message: 'Code de livraison invalide. Doit être 6 chiffres' });
        }

        const { data: seller, error: sellerError } = await supabase
            .from('sellers')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (sellerError) {
            console.error('Error fetching seller:', sellerError);
            return res.status(500).json({ message: 'Error verifying seller' });
        }

        if (!seller) {
            return res.status(404).json({ message: 'Seller not found' });
        }

        const { data: sellerOrder, error: sellerOrderError } = await supabase
            .from('seller_orders')
            .select('id, seller_id, order_id, status, delivery_code_full, delivery_code_attempts')
            .eq('id', sellerOrderId)
            .eq('seller_id', seller.id)
            .maybeSingle();

        if (sellerOrderError) {
            console.error('Error fetching seller order:', sellerOrderError);
            return res.status(500).json({ message: 'Error fetching seller order' });
        }

        if (!sellerOrder) {
            return res.status(404).json({ message: 'Seller order not found' });
        }

        if (sellerOrder.status !== 'shipped') {
            return res.status(400).json({ message: 'Le code de livraison ne peut être vérifié que pour les commandes expédiées' });
        }

        if (!sellerOrder.delivery_code_full) {
            return res.status(400).json({ message: 'Aucun code de livraison trouvé pour cette commande' });
        }

        const codeMatch = verifyCodeMatch(code, sellerOrder.delivery_code_full);

        if (!codeMatch) {
            await supabase
                .from('seller_orders')
                .update({
                    delivery_code_attempts: (sellerOrder.delivery_code_attempts || 0) + 1
                })
                .eq('id', sellerOrderId);

            await supabase
                .from('order_status_log')
                .insert([{
                    seller_order_id: sellerOrderId,
                    previous_status: sellerOrder.status,
                    new_status: sellerOrder.status,
                    changed_by: 'seller',
                    attempted_code: code,
                    success: false
                }]);

            return res.status(400).json({
                message: 'Code de livraison incorrect',
                attemptsRemaining: 3 - ((sellerOrder.delivery_code_attempts || 0) + 1)
            });
        }

        const { error: updateError } = await supabase
            .from('seller_orders')
            .update({
                status: 'delivered',
                delivered_at: new Date().toISOString(),
                delivery_code_attempts: (sellerOrder.delivery_code_attempts || 0) + 1,
                updated_at: new Date().toISOString()
            })
            .eq('id', sellerOrderId);

        if (updateError) {
            console.error('Error updating seller order:', updateError);
            return res.status(500).json({ message: 'Error marking order as delivered' });
        }

        await supabase
            .from('order_status_log')
            .insert([{
                seller_order_id: sellerOrderId,
                previous_status: sellerOrder.status,
                new_status: 'delivered',
                changed_by: 'seller',
                attempted_code: code,
                success: true
            }]);

        await notifyCustomerOrderStatusUpdate({
            orderId: sellerOrder.order_id,
            status: 'delivered',
            sellerId: seller.id
        });

        return res.status(200).json({
            message: 'Livraison confirmée avec succès',
            data: {
                sellerOrderId,
                status: 'delivered',
                deliveredAt: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Confirm delivery error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
