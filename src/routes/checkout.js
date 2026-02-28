/**
 * GET /checkout
 * Payment checkout page served from pay.tishop.co
 * Initiates MonCash payment when user visits this page
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');
const env = require('../db/env');

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

        // Fetch order
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

        // Initiate MonCash payment (request comes FROM pay.tishop.co server)
        console.log('[Checkout] Initiating MonCash payment for order:', orderId);
        
        const moncash = require('../moncash/moncashConfig');
        
        const paymentData = {
            amount: order.total_amount,
            orderId: order.order_number  // Use order_number instead of UUID (MonCash expects short numeric/alphanumeric)
        };

        console.log('[Checkout] MonCash payment payload:', paymentData);

        // Return a loading page while we wait before initiating MonCash payment
        const DELAY_MS = 2000; // 2 second delay - adjust as needed (e.g., 3000 for 3 seconds)
        
        res.type('text/html').send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Paiement en cours</title>
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
                    .spinner {
                        border: 4px solid #f3f3f3;
                        border-top: 4px solid #667eea;
                        border-radius: 50%;
                        width: 40px;
                        height: 40px;
                        animation: spin 1s linear infinite;
                        margin: 0 auto 20px;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                    .message { 
                        color: #333; 
                        font-size: 18px;
                        font-weight: 500;
                    }
                    .submessage {
                        color: #666;
                        font-size: 14px;
                        margin-top: 10px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="spinner"></div>
                    <div class="message">Redirection vers MonCash...</div>
                    <div class="submessage">Veuillez patienter</div>
                </div>
                <script>
                    console.log('[Checkout] Payment page loaded, waiting ${DELAY_MS}ms before redirect');
                </script>
            </body>
            </html>
        `);

        // Wait for the delay, then create and process the MonCash payment
        setTimeout(() => {
            console.log('[Checkout] Delay complete, initiating MonCash payment');
            
            moncash.payment.create(paymentData, function(error, payment) {
                if (error) {
                    const errorDetails = getMoncashErrorDetails(error);
                    console.error('[Checkout] Error creating payment:', errorDetails);
                    return;
                }

                if (!payment || !payment.payment_token) {
                    console.error('[Checkout] Invalid payment response:', payment);
                    return;
                }

                console.log('[Checkout] Payment created, would redirect to MonCash:', moncash.payment.redirect_uri(payment));
            });
        }, DELAY_MS);

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

module.exports = router;