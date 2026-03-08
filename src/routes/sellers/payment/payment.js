const express = require('express');
const router = express.Router();
const authenticateUser = require('../../../middlewares/authMiddleware');
const { supabase } = require('../../../db/supabase');
const { sellerStoreLimiter } = require('../../../middlewares/limit');

const VALID_PAYMENT_METHODS = new Set(['moncash', 'natcash']);

async function getSellerIdByUserId(userId) {
    const { data: sellerRow, error: sellerError } = await supabase
        .from('sellers')
        .select('id')
        .eq('user_id', userId)
        .single();

    if (sellerError || !sellerRow) {
        return { sellerId: null, sellerError };
    }

    return { sellerId: sellerRow.id, sellerError: null };
}

// GET /seller/payment/add-payment
router.get('/add-payment', authenticateUser, sellerStoreLimiter, async (req, res) => {
    try {
        const user = req.user;
        const { sellerId, sellerError } = await getSellerIdByUserId(user.id);

        if (sellerError || !sellerId) {
            console.error('Seller not found:', sellerError);
            return res.status(404).json({ error: 'Seller not found' });
        }

        const { data: payments, error: paymentsError } = await supabase
            .from('payment_methods')
            .select('id, seller_id, method, account_number, account_name, updated_at')
            .eq('seller_id', sellerId)
            .order('method', { ascending: true });

        if (paymentsError) {
            console.error('Error fetching payment methods:', paymentsError);
            return res.status(500).json({ error: 'Error fetching payment methods' });
        }

        return res.status(200).json({
            success: true,
            payment_methods: payments || []
        });
    } catch (error) {
        console.error('Unexpected error while fetching payment methods:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /seller/payment/add-payment
router.post('/add-payment', authenticateUser, sellerStoreLimiter, async (req, res) => {
    try {
        const user = req.user;
        const { payment_method, account_number, account_name } = req.body;
        
        if (!payment_method || !account_number || !account_name) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (!VALID_PAYMENT_METHODS.has(payment_method)) {
            return res.status(400).json({ error: 'Invalid payment method' });
        }

        const { sellerId, sellerError } = await getSellerIdByUserId(user.id);

        if (sellerError || !sellerId) {
            console.error('Seller not found:', sellerError);
            return res.status(404).json({ error: 'Seller not found' });
        }

        const { data: payment, error: paymentError } = await supabase
            .from('payment_methods')
            .upsert({
                seller_id: sellerId,
                method: payment_method,
                account_number,
                account_name,
                updated_at: new Date().toISOString(),
             }, { onConflict: 'seller_id,method' })
            .select('id, seller_id, method, account_number, account_name')
            .single();

        if (paymentError) {
            console.error('Error upserting payment method:', paymentError);
            return res.status(500).json({ error: 'Error saving payment method' });
        }

        return res.status(200).json({
            success: true,
            payment_method: payment
        });

    } catch (error) {
        console.error('Unexpected error while saving payment method:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;