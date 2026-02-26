const express = require('express');
const router = express.Router();
const { supabase } = require('../../db/supabase');
const { generalLimiter } = require('../../middlewares/limit');

const generateDeliveryCode = () => String(Math.floor(100000 + Math.random() * 900000));

/**
 * POST /api/payments/mark-paid
 * Legacy endpoint - marks order as paid and generates delivery codes
 * Kept for backwards compatibility
 */
router.post('/mark-paid', generalLimiter, async (req, res) => {
    try {
        const { orderId, returnCodes = false } = req.body;

        if (!orderId) {
            return res.status(400).json({ message: 'L\'ID de la commande est requis' });
        }

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, order_number, status, total_amount')
            .eq('id', orderId)
            .maybeSingle();

        if (orderError) {
            console.error('Error fetching order:', orderError);
            return res.status(500).json({ message: 'Erreur lors de la récupération de la commande' });
        }

        if (!order) {
            return res.status(404).json({ message: 'Commande introuvable' });
        }

        if (order.status === 'cancelled') {
            return res.status(400).json({ message: 'Les commandes annulées ne peuvent pas être marquées comme payées' });
        }

        const { data: sellerOrders, error: sellerOrdersError } = await supabase
            .from('seller_orders')
            .select('id, status, items_subtotal, delivery_fee, delivery_code_full')
            .eq('order_id', orderId);

        if (sellerOrdersError) {
            console.error('Error fetching seller orders:', sellerOrdersError);
            return res.status(500).json({ message: 'Erreur lors de la récupération des commandes du vendeur' });
        }

        if (!sellerOrders || sellerOrders.length === 0) {
            return res.status(400).json({ message: 'Aucune commande de vendeur trouvée pour cette commande' });
        }

        // Check if order is already paid and codes exist
        const alreadyPaid = order.status === 'paid' && sellerOrders.every(so => so.delivery_code_full);
        
        if (alreadyPaid) {
            // Return existing codes without regenerating
            const existingCodes = sellerOrders.map(so => ({
                sellerOrderId: so.id,
                code: so.delivery_code_full,
            }));

            const subtotal = sellerOrders.reduce((sum, so) => sum + (so.items_subtotal || 0), 0);
            const shippingFee = sellerOrders.reduce((sum, so) => sum + (so.delivery_fee || 0), 0);

            return res.status(200).json({
                message: 'Commande déjà payée',
                data: {
                    orderId,
                    orderNumber: order.order_number,
                    status: 'paid',
                    subtotal: subtotal,
                    shippingFee: shippingFee,
                    total: order.total_amount,
                    deliveryCodes: returnCodes ? existingCodes : []
                }
            });
        }

        const deliveryCodes = [];
        for (const sellerOrder of sellerOrders) {
            const code = generateDeliveryCode();

            const { error: updateError } = await supabase
                .from('seller_orders')
                .update({
                    status: 'confirmed',
                    delivery_code_full: code,
                    delivery_code_attempts: 0,
                    confirmed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', sellerOrder.id);

            if (updateError) {
                console.error('Error updating seller order:', updateError);
                return res.status(500).json({ message: 'Erreur lors de la mise à jour de la commande du vendeur' });
            }

            const { error: logError } = await supabase
                .from('order_status_log')
                .insert([{
                    seller_order_id: sellerOrder.id,
                    previous_status: sellerOrder.status,
                    new_status: 'confirmed',
                    changed_by: 'system',
                    success: true
                }]);

            if (logError) {
                console.error('Error logging status update:', logError);
                return res.status(500).json({ message: 'Erreur lors de l\'enregistrement de la mise à jour du statut' });
            }

            if (returnCodes) {
                deliveryCodes.push({
                    sellerOrderId: sellerOrder.id,
                    code: code,
                });
            }
        }

        // Calculate subtotal and shipping fee
        const subtotal = sellerOrders.reduce((sum, so) => sum + (so.items_subtotal || 0), 0);
        const shippingFee = sellerOrders.reduce((sum, so) => sum + (so.delivery_fee || 0), 0);

        const { error: orderUpdateError } = await supabase
            .from('orders')
            .update({
                status: 'paid',
                updated_at: new Date().toISOString()
            })
            .eq('id', orderId);

        if (orderUpdateError) {
            console.error('Error updating order:', orderUpdateError);
            return res.status(500).json({ message: 'Erreur lors de la mise à jour du statut de la commande' });
        }

        return res.status(200).json({
            message: 'Commande marquée comme payée',
            data: {
                orderId,
                orderNumber: order.order_number,
                status: 'paid',
                subtotal: subtotal,
                shippingFee: shippingFee,
                total: order.total_amount,
                deliveryCodes: returnCodes ? deliveryCodes : []
            }
        });
    } catch (error) {
        console.error('Mark paid error:', error);
        return res.status(500).json({ message: 'Erreur serveur interne' });
    }
});

module.exports = router;
