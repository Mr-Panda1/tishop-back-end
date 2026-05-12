const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../../db/supabase');
const { decryptFields } = require('../../utils/encryption');

const PAYMENT_METHOD_ENCRYPTED_FIELDS = ['account_name', 'account_number'];

// GET /api/shop/:shopId/payment-methods
// Public endpoint — returns payment methods configured by a shop's seller
router.get('/:shopId/payment-methods', async (req, res) => {
    const { shopId } = req.params;

    try {
        // Resolve seller_id from the shop
        const { data: shop, error: shopError } = await supabase
            .from('shops')
            .select('seller_id')
            .eq('id', shopId)
            .single();

        if (shopError || !shop) {
            return res.status(404).json({ success: false, error: 'Shop not found' });
        }

        // Fetch payment methods for this seller
        const { data: paymentMethods, error: pmError } = await supabase
            .from('payment_methods')
            .select('method, account_number, account_name')
            .eq('seller_id', shop.seller_id);

        if (pmError) {
            console.error('Error fetching shop payment methods:', pmError);
            return res.status(500).json({ success: false, error: 'Failed to fetch payment methods' });
        }

        const decryptedPaymentMethods = (paymentMethods || []).map((method) =>
            decryptFields(method, PAYMENT_METHOD_ENCRYPTED_FIELDS)
        );

        return res.json({ success: true, payment_methods: decryptedPaymentMethods });
    } catch (error) {
        console.error('Shop payment methods error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/shop/:shopId/delivery-options?commune=COMMUNE_NAME
router.get('/:shopId/delivery-options', async (req, res) => {
    const { shopId } = req.params;
    const { commune } = req.query;
    try {
        let query = supabase
            .from('delivery_options')
            .select('id, commune_id, price, estimated_days')
            .eq('shop_id', shopId)
            .eq('is_active', true);
        if (commune) query = query.eq('commune_id', commune);
        const { data, error } = await query;
        if (error) {
            console.error('Error fetching delivery options:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch delivery options' });
        }
        return res.json({ success: true, delivery_options: data || [] });
    } catch (error) {
        console.error('Shop delivery options error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/shop/:shopId/pickup-points
router.get('/:shopId/pickup-points', async (req, res) => {
    const { shopId } = req.params;
    try {
        const { data, error } = await supabase
            .from('pickup_points')
            .select('id, commune_id, quartier, landmark, instructions, phone, gps_coordinates')
            .eq('shop_id', shopId)
            .eq('is_active', true);
        if (error) {
            console.error('Error fetching pickup points:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch pickup points' });
        }
        return res.json({ success: true, pickup_points: data || [] });
    } catch (error) {
        console.error('Shop pickup points error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/shop/:shopId/policies
// Public endpoint — returns published store rules for a shop.
router.get('/:shopId/policies', async (req, res) => {
    const { shopId } = req.params;

    try {
        const { data: policy, error } = await supabaseAdmin
            .from('seller_store_policies')
            .select('id, shop_id, preset, cancellation_window_hours, delivery_min_days, delivery_max_days, pickup_enabled, pickup_instructions, damaged_claim_window_days, support_contact_method, support_contact_value, is_published, updated_at')
            .eq('shop_id', shopId)
            .eq('is_published', true)
            .maybeSingle();

        if (error) {
            console.error('Error fetching shop policies:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch shop policies' });
        }

        return res.status(200).json({ success: true, policy: policy || null });
    } catch (error) {
        console.error('Shop policies error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
