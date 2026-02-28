/**
 * GET /checkout
 * Loads the checkout page (pay.tishop.co)
 * Does NOT initiate MonCash payment yet - waits for frontend to request it
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');

function getMoncashErrorDetails(error) {
    return {
        message: error?.message,
        httpStatusCode: error?.httpStatusCode,
        response: error?.response,
        stack: error?.stack
    };
}

router.get('/checkout', async (req, res) => {
    try {
        const { orderId } = req.query;

        if (!orderId) {
            return res.status(400).type('text/html').send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>Erreur de paiement</title>
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                        .error { color: #d32f2f; font-size: 18px; }
                    </style>
                </head>
                <body>
                    <div class="error">Erreur: ID de commande manquant</div>
                    <p><a href="https://tishop.co">Retour à l'accueil</a></p>
                </body>
                </html>
            `);
        }

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, order_number, total_amount, status')
            .eq('id', orderId)
            .maybeSingle();

        if (orderError || !order) {
            return res.status(404).type('text/html').send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>Erreur de paiement</title>
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                        .error { color: #d32f2f; font-size: 18px; }
                    </style>
                </head>
                <body>
                    <div class="error">Erreur: Commande introuvable</div>
                    <p><a href="https://tishop.co">Retour à l'accueil</a></p>
                </body>
                </html>
            `);
        }

        if (order.status === 'paid') {
            return res.status(400).type('text/html').send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>Erreur de paiement</title>
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                        .error { color: #d32f2f; font-size: 18px; }
                    </style>
                </head>
                <body>
                    <div class="error">Cette commande a déjà été payée</div>
                    <p><a href="https://tishop.co">Retour à l'accueil</a></p>
                </body>
                </html>
            `);
        }

        console.log('[Checkout] Loading checkout page for order:', orderId);

        res.type('text/html').send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Paiement</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        text-align: center;
                        padding: 50px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        min-height: 100vh;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        margin: 0;
                    }
                    .container {
                        background: white;
                        padding: 40px;
                        border-radius: 10px;
                        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
                        max-width: 400px;
                    }
                    .message {
                        color: #333;
                        font-size: 18px;
                        font-weight: 500;
                        margin-bottom: 30px;
                    }
                    .amount {
                        color: #667eea;
                        font-size: 32px;
                        font-weight: bold;
                        margin: 20px 0;
                    }
                    .btn {
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        border: none;
                        padding: 12px 30px;
                        font-size: 16px;
                        border-radius: 5px;
                        cursor: pointer;
                        margin-top: 20px;
                        transition: transform 0.2s;
                    }
                    .btn:hover {
                        transform: scale(1.05);
                    }
                    .btn:disabled {
                        opacity: 0.6;
                        cursor: not-allowed;
                        transform: scale(1);
                    }
                    .spinner {
                        border: 3px solid #f3f3f3;
                        border-top: 3px solid #667eea;
                        border-radius: 50%;
                        width: 30px;
                        height: 30px;
                        animation: spin 1s linear infinite;
                        margin: 12px auto 0;
                        display: none;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                    .error {
                        color: #d32f2f;
                        margin-top: 10px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="message">Montant à payer</div>
                    <div class="amount">$${order.total_amount}</div>
                    <button class="btn" id="payBtn" onclick="initiateMoncashPayment()">
                        Passer au paiement MonCash
                    </button>
                    <div class="spinner" id="spinner"></div>
                    <div class="error" id="error"></div>
                </div>
                <script>
                    const orderId = '${orderId}';

                    async function initiateMoncashPayment() {
                        const btn = document.getElementById('payBtn');
                        const spinner = document.getElementById('spinner');
                        const error = document.getElementById('error');

                        btn.disabled = true;
                        spinner.style.display = 'block';
                        error.textContent = '';

                        try {
                            const response = await fetch('/api/checkout/initiate-payment', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ orderId })
                            });

                            const data = await response.json();

                            if (!response.ok) {
                                throw new Error(data.error || 'Payment initiation failed');
                            }

                            if (data.redirectUri) {
                                setTimeout(() => {
                                    window.location.href = data.redirectUri;
                                }, 2000);
                                return;
                            }

                            throw new Error('No redirect URI');
                        } catch (err) {
                            error.textContent = 'Erreur: ' + err.message;
                            btn.disabled = false;
                            spinner.style.display = 'none';
                        }
                    }
                </script>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('[Checkout] Unexpected error:', error);
        res.status(500).type('text/html').send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Erreur serveur</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    .error { color: #d32f2f; font-size: 18px; }
                </style>
            </head>
            <body>
                <div class="error">Erreur serveur interne</div>
                <p><a href="https://tishop.co">Retour à l'accueil</a></p>
            </body>
            </html>
        `);
    }
});

/**
 * POST /api/checkout/initiate-payment
 * Called by the frontend (pay.tishop.co) when user clicks the pay button
 * Initiates MonCash payment and returns redirect URI
 */
router.post('/api/checkout/initiate-payment', async (req, res) => {
    try {
        const { orderId } = req.body;

        if (!orderId) {
            return res.status(400).json({ error: 'Missing orderId' });
        }

        console.log('[API] Initiating MonCash payment for order:', orderId);

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, order_number, total_amount, status')
            .eq('id', orderId)
            .maybeSingle();

        if (orderError || !order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.status === 'paid') {
            return res.status(400).json({ error: 'Order already paid' });
        }

        const moncash = require('../moncash/moncashConfig');

        const paymentData = {
            amount: order.total_amount,
            orderId: order.order_number
        };

        moncash.payment.create(paymentData, function(error, payment) {
            if (error) {
                const errorDetails = getMoncashErrorDetails(error);
                console.error('[API] Error creating payment:', errorDetails);
                return res.status(500).json({ error: error.response?.message || error.message });
            }

            if (!payment || !payment.payment_token) {
                console.error('[API] Invalid payment response:', payment);
                return res.status(500).json({ error: 'Invalid MonCash response' });
            }

            const redirectUri = moncash.payment.redirect_uri(payment);
            return res.json({ success: true, redirectUri });
        });
    } catch (error) {
        console.error('[API] Unexpected error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
