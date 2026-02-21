const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { supabase } = require('../../db/supabase');

const generateDeliveryCode = () => String(Math.floor(100000 + Math.random() * 900000));


// Mark order as paid and generate delivery codes
router.post('/mark-paid', async (req, res) => {
    try {
        const { orderId, returnCodes = false } = req.body;

        if (!orderId) {
            return res.status(400).json({ message: 'orderId is required' });
        }

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, order_number, status, total_amount')
            .eq('id', orderId)
            .maybeSingle();

        if (orderError) {
            console.error('Error fetching order:', orderError);
            return res.status(500).json({ message: 'Error fetching order' });
        }

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        if (order.status === 'cancelled') {
            return res.status(400).json({ message: 'Cancelled orders cannot be marked as paid' });
        }

        const { data: sellerOrders, error: sellerOrdersError } = await supabase
            .from('seller_orders')
            .select('id, status, items_subtotal, delivery_fee, delivery_code_full')
            .eq('order_id', orderId);

        if (sellerOrdersError) {
            console.error('Error fetching seller orders:', sellerOrdersError);
            return res.status(500).json({ message: 'Error fetching seller orders' });
        }

        if (!sellerOrders || sellerOrders.length === 0) {
            return res.status(400).json({ message: 'No seller orders found for this order' });
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
                message: 'Order already paid',
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
                return res.status(500).json({ message: 'Error updating seller order' });
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
                return res.status(500).json({ message: 'Error logging status update' });
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
            return res.status(500).json({ message: 'Error updating order status' });
        }

        return res.status(200).json({
            message: 'Order marked as paid',
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
        return res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
