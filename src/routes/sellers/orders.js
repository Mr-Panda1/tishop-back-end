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
                .select('id, order_number, customer_name, customer_email, customer_phone, total_amount, status, created_at, department_id, arrondissement_id, commune_id, neighborhood, landmark')
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

            const itemsBySellerOrderId = new Map();
            (items || []).forEach(item => {
                if (!itemsBySellerOrderId.has(item.seller_order_id)) {
                    itemsBySellerOrderId.set(item.seller_order_id, []);
                }
                itemsBySellerOrderId.get(item.seller_order_id).push(item);
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

        return res.status(200).json({
            message: 'Commande du vendeur récupérée',
            data: {
                ...sellerOrder,
                order,
                items: items || []
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

        if (!status || !['shipped', 'delivered'].includes(status)) {
            return res.status(400).json({ message: 'Statut invalide. Doit être "expédié" ou "livré"' });
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
            pending: ['shipped', 'cancelled'],
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

        if (status === 'shipped') {
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
