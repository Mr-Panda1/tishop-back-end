const express = require('express');
const router = express.Router();
const authenticateUser = require('../../middlewares/authMiddleware');
const { supabase } = require('../../db/supabase');
const { sellerStoreLimiter } = require('../../middlewares/limit');

const verifyCodeMatch = (inputCode, storedCode) => inputCode === storedCode;

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
        const { status } = req.body;

        if (!status || !['confirmed', 'shipped', 'delivered'].includes(status)) {
            return res.status(400).json({ message: 'Statut invalide. Doit être "confirmé", "expédié" ou "livré"' });
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
            .select('id, seller_id, status, order_id')
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
