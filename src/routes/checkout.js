/**
 * GET /checkout
 * Payment checkout page served from pay.tishop.co
 * Initiates MonCash payment when user visits this page
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');
const env = require('../db/env');

router.get('/checkout', async (req, res) => {
    try {
        const { orderId } = req.query;

        if (!orderId) {
            return res.status(400).html(`
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
            return res.status(404).html(`
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
            return res.status(400).html(`
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
        
        const moncash = require('../../moncash/moncashConfig');
        
        const paymentData = {
            amount: order.total_amount,
            orderId: order.id
        };

        moncash.payment.create(paymentData, function(error, payment) {
            if (error) {
                console.error('[Checkout] Error creating payment:', error.message);
                return res.status(500).html(`
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
                        <div class="error">Erreur lors de la création du paiement Moncash</div>
                        <p>${error.message}</p>
                        <p><a href="https://tishop.co">Retour à l'accueil</a></p>
                    </body>
                    </html>
                `);
            }

            if (!payment || !payment.payment_token) {
                console.error('[Checkout] Invalid payment response:', payment);
                return res.status(500).html(`
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
                        <div class="error">Réponse Moncash invalide</div>
                        <p><a href="https://tishop.co">Retour à l'accueil</a></p>
                    </body>
                    </html>
                `);
            }

            console.log('[Checkout] Payment created, redirecting to MonCash');
            
            const redirectUri = moncash.payment.redirect_uri(payment);
            
            // Redirect to MonCash gateway
            res.redirect(redirectUri);
        });

    } catch (error) {
        console.error('[Checkout] Unexpected error:', error);
        res.status(500).html(`
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
