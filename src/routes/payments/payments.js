const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { supabase } = require('../../db/supabase');
const { generalLimiter } = require('../../middlewares/limit');

const generateDeliveryCode = () => String(Math.floor(100000 + Math.random() * 900000));


// Mark order as paid and generate delivery codes
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

// Create Moncash payment
// POST /api/payments/create
router.post('/create', generalLimiter, async (req, res) => {
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
            console.error('Error fetching order:', orderError);
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
            orderId: order.id.toString()
        };

        console.log('[Payment Create] Attempting to create payment with data:', paymentData);

        moncash.payment.create(paymentData, function (error, payment) {
            if (error) {
                console.error('[Payment Create] Moncash error response:', {
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
                console.error('[Payment Create] Invalid payment response:', payment);
                return res.status(500).json({ message: 'Réponse Moncash invalide' });
            }

            console.log('[Payment Create] Payment created successfully, token:', payment.payment_token.token.substring(0, 20) + '...');

            const redirectUri = moncash.payment.redirect_uri(payment);

            return res.status(200).json({
                message: 'Paiement créé avec succès',
                data: {
                    payment_token: payment.payment_token.token,
                    redirect_uri: redirectUri
                }
            });
        });
    } catch (error) {
        console.error('Create payment error:', error);
        return res.status(500).json({ message: 'Erreur serveur interne' });
    }
});

// Payment callback from Moncash
// GET /api/payments/callback
router.get('/callback', async (req, res) => {
    try {
        const { transaction_id, order_id } = req.query;

        if (!transaction_id || !order_id) {
            console.error('Missing callback parameters:', { transaction_id, order_id });
            return res.redirect(`https://tishop.co/shop/checkout?error=missing_params`);
        }

        // Fetch order to verify it exists and get its amount
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, order_number, total_amount, customer_email')
            .eq('id', order_id)
            .maybeSingle();

        if (orderError || !order) {
            console.error('Order fetch error:', orderError);
            return res.redirect(`https://tishop.co/shop/checkout?error=order_not_found`);
        }

        // Verify payment with Moncash SDK
        const moncash = require('../../moncash/moncashConfig');

        moncash.capture.getByTransactionId(transaction_id, function (error, capture) {
            if (error) {
                console.error('Moncash capture error:', error);
                return res.redirect(`https://tishop.co/shop/checkout?error=payment_verification_failed`);
            }

            if (!capture || !capture.payment) {
                console.error('Invalid capture response:', capture);
                return res.redirect(`https://tishop.co/shop/checkout?error=invalid_capture`);
            }

            const payment = capture.payment;

            // Verify payment success and amount
            if (payment.message !== 'successful') {
                console.warn(`Payment not successful: ${payment.message}`);
                return res.redirect(`https://tishop.co/shop/checkout?error=payment_not_successful`);
            }

            if (parseFloat(payment.cost) !== parseFloat(order.total_amount)) {
                console.warn(`Payment amount mismatch: ${payment.cost} vs ${order.total_amount}`);
                return res.redirect(`https://tishop.co/shop/checkout?error=amount_mismatch`);
            }

            // Mark order as paid (calls internal logic to generate delivery codes)
            const markPaidData = { orderId: order.id, returnCodes: true };

            // Make internal call to /mark-paid
            // We'll use the existing mark-paid logic directly
            (async () => {
                try {
                    // Generate delivery codes (copy of mark-paid logic)
                    const { data: sellerOrders, error: sellerOrdersError } = await supabase
                        .from('seller_orders')
                        .select('id, status, items_subtotal, delivery_fee, delivery_code_full')
                        .eq('order_id', order.id);

                    if (sellerOrdersError || !sellerOrders || sellerOrders.length === 0) {
                        return res.redirect(`https://tishop.co/shop/checkout?error=seller_orders_error`);
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
                            return res.redirect(`https://tishop.co/shop/checkout?error=seller_order_update_failed`);
                        }

                        const { error: logError } = await supabase
                            .from('order_status_log')
                            .insert([{
                                seller_order_id: sellerOrder.id,
                                previous_status: sellerOrder.status,
                                new_status: 'confirmed',
                                changed_by: 'moncash_callback',
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

                    // Update order status
                    const { error: orderUpdateError } = await supabase
                        .from('orders')
                        .update({
                            status: 'paid',
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', order.id);

                    if (orderUpdateError) {
                        console.error('Error updating order:', orderUpdateError);
                        return res.redirect(`https://tishop.co/shop/checkout?error=order_update_failed`);
                    }

                    // Send confirmation email
                    try {
                        const { sendOrderConfirmationEmail } = require('../../email/customer/orderConfirmation');
                        await sendOrderConfirmationEmail(order.customer_email, order.order_number);
                    } catch (emailError) {
                        console.error('Error sending confirmation email:', emailError);
                        // Don't fail the transaction if email fails
                    }

                    // Redirect to order confirmation page
                    return res.redirect(`https://tishop.co/shop/order-confirmation?orderId=${order.id}`);
                } catch (innerError) {
                    console.error('Callback processing error:', innerError);
                    return res.redirect(`https://tishop.co/shop/checkout?error=processing_error`);
                }
            })();
        });
    } catch (error) {
        console.error('Callback handler error:', error);
        return res.redirect(`https://tishop.co/shop/checkout?error=server_error`);
    }
});

module.exports = router;
