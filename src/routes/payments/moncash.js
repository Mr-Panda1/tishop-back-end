const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { supabase } = require('../../db/supabase');
const { generalLimiter } = require('../../middlewares/limit');
const env = require('../../db/env');

const generateDeliveryCode = () => String(Math.floor(100000 + Math.random() * 900000));

/**
 * Helper: Mark order as paid with delivery codes
 * Prevents duplicate code generation on retries
 */
async function markOrderPaidInternal(orderId) {
    try {
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, order_number, status, total_amount, customer_email')
            .eq('id', orderId)
            .maybeSingle();

        if (orderError || !order) {
            throw new Error('Order not found');
        }

        // If already paid with codes, return success without regenerating
        if (order.status === 'paid') {
            const { data: sellerOrders } = await supabase
                .from('seller_orders')
                .select('id, delivery_code_full')
                .eq('order_id', orderId);

            if (sellerOrders && sellerOrders.every(so => so.delivery_code_full)) {
                console.log(`[Moncash] Order ${orderId} already paid with codes, skipping code regeneration`);
                return { success: true, alreadyPaid: true, orderId };
            }
        }

        // Cancel if order was cancelled
        if (order.status === 'cancelled') {
            throw new Error('Order has been cancelled');
        }

        const { data: sellerOrders, error: sellerOrdersError } = await supabase
            .from('seller_orders')
            .select('id, status, items_subtotal, delivery_fee, delivery_code_full')
            .eq('order_id', orderId);

        if (sellerOrdersError || !sellerOrders || sellerOrders.length === 0) {
            throw new Error('No seller orders found');
        }

        const deliveryCodes = [];
        for (const sellerOrder of sellerOrders) {
            // Skip if already has delivery code
            if (sellerOrder.delivery_code_full) {
                deliveryCodes.push({
                    sellerOrderId: sellerOrder.id,
                    code: sellerOrder.delivery_code_full,
                });
                continue;
            }

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
                throw new Error(`Failed to update seller order: ${updateError.message}`);
            }

            const { error: logError } = await supabase
                .from('order_status_log')
                .insert([{
                    seller_order_id: sellerOrder.id,
                    previous_status: sellerOrder.status,
                    new_status: 'confirmed',
                    changed_by: 'moncash_payment',
                    success: true
                }]);

            if (logError) {
                console.error('Error logging status update:', logError);
            }

            deliveryCodes.push({
                sellerOrderId: sellerOrder.id,
                code: code,
            });
        }

        // Update order status to paid
        const { error: orderUpdateError } = await supabase
            .from('orders')
            .update({
                status: 'paid',
                updated_at: new Date().toISOString()
            })
            .eq('id', orderId);

        if (orderUpdateError) {
            throw new Error(`Failed to update order: ${orderUpdateError.message}`);
        }

        // Send confirmation email
        try {
            const { sendOrderConfirmationEmail } = require('../../email/customer/orderConfirmation');
            await sendOrderConfirmationEmail(order.customer_email, order.order_number);
        } catch (emailError) {
            console.error('Error sending confirmation email:', emailError);
            // Don't fail if email sends fails
        }

        return {
            success: true,
            alreadyPaid: false,
            orderId,
            deliveryCodes
        };
    } catch (error) {
        console.error('[Moncash] Error marking order as paid:', error);
        throw error;
    }
}

/**
 * POST /api/moncash/initiate
 * Start MonCash payment - called from frontend
 */
router.post('/initiate', generalLimiter, async (req, res) => {
    try {
        const { orderId } = req.body;

        if (!orderId) {
            return res.status(400).json({ message: 'L\'ID de la commande est requis' });
        }

        // Fetch order from database
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, order_number, total_amount, status')
            .eq('id', orderId)
            .maybeSingle();

        if (orderError) {
            console.error('[Moncash] Error fetching order:', orderError);
            return res.status(500).json({ message: 'Erreur lors de la récupération de la commande' });
        }

        if (!order) {
            return res.status(404).json({ message: 'Commande introuvable' });
        }

        if (order.status === 'paid') {
            return res.status(400).json({ message: 'Cette commande a déjà été payée' });
        }

        if (order.status === 'cancelled') {
            return res.status(400).json({ message: 'Cette commande a été annulée' });
        }

        // Create payment with Moncash SDK
        const moncash = require('../../moncash/moncashConfig');
        
        const paymentData = {
            amount: order.total_amount,
            orderId: order.order_number  // Use order_number instead of UUID
        };

        console.log('[Moncash Initiate] Creating payment for order:', paymentData);

        moncash.payment.create(paymentData, function (error, payment) {
            if (error) {
                console.error('[Moncash Initiate] Error creating payment:', {
                    message: error.message,
                    response: error.response,
                    httpStatusCode: error.httpStatusCode
                });
                return res.status(500).json({ 
                    message: 'Erreur lors de la création du paiement Moncash',
                    details: error.response?.message || error.message
                });
            }

            if (!payment || !payment.payment_token) {
                console.error('[Moncash Initiate] Invalid payment response:', payment);
                return res.status(500).json({ message: 'Réponse Moncash invalide' });
            }

            console.log('[Moncash Initiate] Payment created, token:', payment.payment_token.token.substring(0, 20) + '...');

            const redirectUri = moncash.payment.redirect_uri(payment);

            return res.status(200).json({
                message: 'Paiement créé avec succès',
                data: {
                    payment_token: payment.payment_token.token,
                    redirect_uri: redirectUri,
                    orderId: order.id
                }
            });
        });
    } catch (error) {
        console.error('[Moncash Initiate] Unexpected error:', error);
        return res.status(500).json({ message: 'Erreur serveur interne' });
    }
});

/**
 * GET /api/moncash/return
 * Handle MonCash return redirect after payment
 * User is redirected here by MonCash with transaction_id
 */
router.get('/return', async (req, res) => {
    try {
        const { transaction_id, order_id } = req.query;

        if (!transaction_id || !order_id) {
            console.error('[Moncash Return] Missing parameters:', { transaction_id, order_id });
            return res.redirect(`${env.frontendOrderConfirmationUrl}?error=missing_transaction_params`);
        }

        // Fetch order to verify it exists and get its amount
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, order_number, total_amount, customer_email')
            .eq('id', order_id)
            .maybeSingle();

        if (orderError || !order) {
            console.error('[Moncash Return] Order not found:', order_id);
            return res.redirect(`${env.frontendOrderConfirmationUrl}?error=order_not_found&orderId=${order_id}`);
        }

        // Verify payment with Moncash SDK
        const moncash = require('../../moncash/moncashConfig');

        moncash.capture.getByTransactionId(transaction_id, function (error, capture) {
            if (error) {
                console.error('[Moncash Return] Verification error:', error);
                return res.redirect(`${env.frontendOrderConfirmationUrl}?error=verification_failed&orderId=${order_id}`);
            }

            if (!capture || !capture.payment) {
                console.error('[Moncash Return] Invalid capture response:', capture);
                return res.redirect(`${env.frontendOrderConfirmationUrl}?error=invalid_response&orderId=${order_id}`);
            }

            const payment = capture.payment;

            // Verify payment success
            if (payment.message !== 'successful') {
                console.warn(`[Moncash Return] Payment not successful: ${payment.message}`);
                return res.redirect(`${env.frontendOrderConfirmationUrl}?error=payment_unsuccessful&orderId=${order_id}&status=${payment.message}`);
            }

            // Verify payment amount
            if (parseFloat(payment.cost) !== parseFloat(order.total_amount)) {
                console.warn(`[Moncash Return] Amount mismatch: ${payment.cost} vs ${order.total_amount}`);
                return res.redirect(`${env.frontendOrderConfirmationUrl}?error=amount_mismatch&orderId=${order_id}`);
            }

            // Mark order as paid
            (async () => {
                try {
                    await markOrderPaidInternal(order.id);
                    console.log(`[Moncash Return] Order ${order.id} marked as paid successfully`);
                    return res.redirect(`${env.frontendOrderConfirmationUrl}?orderId=${order.id}&success=true`);
                } catch (innerError) {
                    console.error('[Moncash Return] Error marking order as paid:', innerError);
                    return res.redirect(`${env.frontendOrderConfirmationUrl}?error=order_update_failed&orderId=${order_id}`);
                }
            })();
        });
    } catch (error) {
        console.error('[Moncash Return] Unexpected error:', error);
        return res.redirect(`${env.frontendOrderConfirmationUrl}?error=server_error`);
    }
});

/**
 * POST /api/moncash/webhook
 * Handle MonCash server-to-server webhook notification
 * Redundant verification for payment confirmation
 */
router.post('/webhook', async (req, res) => {
    try {
        const { transaction_id, order_id, payment_status } = req.body;

        console.log('[Moncash Webhook] Received notification:', { transaction_id, order_id, payment_status });

        // Validate webhook payload
        if (!transaction_id || !order_id) {
            console.error('[Moncash Webhook] Invalid payload');
            return res.status(400).json({ error: 'Invalid payload' });
        }

        // Verify payment with MonCash API
        const moncash = require('../../moncash/moncashConfig');

        moncash.capture.getByTransactionId(transaction_id, async function (error, capture) {
            if (error) {
                console.error('[Moncash Webhook] Verification failed:', error);
                return res.status(500).json({ error: 'Verification failed' });
            }

            if (!capture || !capture.payment) {
                console.error('[Moncash Webhook] Invalid capture response:', capture);
                return res.status(500).json({ error: 'Invalid capture response' });
            }

            const payment = capture.payment;

            // Only process successful payments
            if (payment.message !== 'successful') {
                console.warn(`[Moncash Webhook] Payment not successful: ${payment.message}`);
                return res.status(200).json({ status: 'acknowledged', message: 'Payment not successful' });
            }

            // Verify order amount
            const { data: order } = await supabase
                .from('orders')
                .select('id, total_amount')
                .eq('id', order_id)
                .maybeSingle();

            if (!order) {
                console.error('[Moncash Webhook] Order not found:', order_id);
                return res.status(404).json({ error: 'Order not found' });
            }

            if (parseFloat(payment.cost) !== parseFloat(order.total_amount)) {
                console.warn(`[Moncash Webhook] Amount mismatch: ${payment.cost} vs ${order.total_amount}`);
                return res.status(400).json({ error: 'Amount mismatch' });
            }

            // Mark order as paid
            try {
                await markOrderPaidInternal(order.id);
                console.log(`[Moncash Webhook] Order ${order.id} marked as paid`);
                return res.status(200).json({ status: 'success', message: 'Order marked as paid' });
            } catch (innerError) {
                console.error('[Moncash Webhook] Error marking order as paid:', innerError);
                return res.status(500).json({ error: 'Failed to update order' });
            }
        });
    } catch (error) {
        console.error('[Moncash Webhook] Unexpected error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
