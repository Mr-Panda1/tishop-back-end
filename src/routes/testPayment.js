const express = require('express');
const router = express.Router();

/**
 * POST /api/test-payment/create
 * Simple test endpoint to create a MonCash payment without database lookup
 * For testing MonCash integration only
 */
router.post('/create', async (req, res) => {
    try {
        const { orderId, amount } = req.body;

        if (!orderId || !amount) {
            return res.status(400).json({ error: 'orderId and amount are required' });
        }

        console.log('[Test Payment] Creating test payment:', { orderId, amount });

        const moncash = require('../moncash/moncashConfig');

        const paymentData = {
            amount: parseFloat(amount),
            orderId: String(orderId)
        };

        moncash.payment.create(paymentData, function(error, payment) {
            if (error) {
                console.error('[Test Payment] Error:', error);
                return res.status(500).json({ 
                    error: error.message || 'Failed to create payment',
                    details: error.response
                });
            }

            if (!payment || !payment.payment_token) {
                console.error('[Test Payment] Invalid payment response:', payment);
                return res.status(500).json({ error: 'Invalid MonCash response' });
            }

            console.log('[Test Payment] Payment created successfully');

            const redirectUri = moncash.payment.redirect_uri(payment);
            
            return res.json({ 
                success: true, 
                redirectUri,
                data: {
                    payment_token: payment.payment_token.token,
                    orderId: paymentData.orderId,
                    amount: paymentData.amount,
                    status: payment.status,
                    mode: payment.mode
                }
            });
        });
    } catch (error) {
        console.error('[Test Payment] Unexpected error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
