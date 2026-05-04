const express = require('express');
const router = express.Router();
const authenticateUser = require('../../../middlewares/authMiddleware');
const { authLimiter } = require('../../../middlewares/limit');
const { supabaseAdmin } = require('../../../db/supabase');

const PRESETS = new Set(['flexible', 'standard', 'strict']);
const CONTACT_METHODS = new Set(['whatsapp', 'email', 'phone']);

async function getSellerAndShopByUserId(userId) {
    const { data: seller, error: sellerError } = await supabaseAdmin
        .from('sellers')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

    if (sellerError) {
        return { seller: null, shop: null, error: sellerError };
    }

    if (!seller) {
        return { seller: null, shop: null, error: null };
    }

    const { data: shop, error: shopError } = await supabaseAdmin
        .from('shops')
        .select('id')
        .eq('seller_id', seller.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (shopError) {
        return { seller, shop: null, error: shopError };
    }

    return { seller, shop, error: null };
}

router.get('/policies', authLimiter, authenticateUser, async (req, res) => {
    try {
        const { seller, shop, error } = await getSellerAndShopByUserId(req.user.id);

        if (error) {
            console.error('Error resolving seller/shop policies context:', error);
            return res.status(500).json({ success: false, message: 'Erreur lors de la récupération des règles.' });
        }

        if (!seller || !shop) {
            return res.status(404).json({ success: false, message: 'Vendeur ou boutique introuvable.' });
        }

        const { data: policy, error: policyError } = await supabaseAdmin
            .from('seller_store_policies')
            .select('id, seller_id, shop_id, preset, cancellation_window_hours, delivery_min_days, delivery_max_days, pickup_enabled, pickup_instructions, damaged_claim_window_days, support_contact_method, support_contact_value, is_published, created_at, updated_at')
            .eq('seller_id', seller.id)
            .eq('shop_id', shop.id)
            .maybeSingle();

        if (policyError) {
            console.error('Error fetching seller store policies:', policyError);
            return res.status(500).json({ success: false, message: 'Erreur lors de la récupération des règles.' });
        }

        return res.status(200).json({ success: true, policy: policy || null });
    } catch (error) {
        console.error('Get seller store policies error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

router.put('/policies', authLimiter, authenticateUser, async (req, res) => {
    try {
        const {
            preset,
            cancellation_window_hours,
            delivery_min_days,
            delivery_max_days,
            pickup_enabled,
            pickup_instructions,
            damaged_claim_window_days,
            support_contact_method,
            support_contact_value,
            is_published,
        } = req.body || {};

        if (!PRESETS.has(preset)) {
            return res.status(400).json({ success: false, message: 'Preset invalide.' });
        }

        if (!CONTACT_METHODS.has(support_contact_method)) {
            return res.status(400).json({ success: false, message: 'Méthode de contact invalide.' });
        }

        const cancellationWindow = Number(cancellation_window_hours);
        const deliveryMinDays = Number(delivery_min_days);
        const deliveryMaxDays = Number(delivery_max_days);
        const damagedClaimDays = Number(damaged_claim_window_days);

        if ([cancellationWindow, deliveryMinDays, deliveryMaxDays, damagedClaimDays].some((value) => Number.isNaN(value) || value < 0)) {
            return res.status(400).json({ success: false, message: 'Les délais doivent être des nombres valides >= 0.' });
        }

        if (deliveryMinDays > deliveryMaxDays) {
            return res.status(400).json({ success: false, message: 'Le délai minimum de livraison ne peut pas dépasser le délai maximum.' });
        }

        if (!String(support_contact_value || '').trim()) {
            return res.status(400).json({ success: false, message: 'La valeur du contact client est requise.' });
        }

        const { seller, shop, error } = await getSellerAndShopByUserId(req.user.id);

        if (error) {
            console.error('Error resolving seller/shop for policy update:', error);
            return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour des règles.' });
        }

        if (!seller || !shop) {
            return res.status(404).json({ success: false, message: 'Vendeur ou boutique introuvable.' });
        }

        const payload = {
            seller_id: seller.id,
            shop_id: shop.id,
            preset,
            cancellation_window_hours: cancellationWindow,
            delivery_min_days: deliveryMinDays,
            delivery_max_days: deliveryMaxDays,
            pickup_enabled: Boolean(pickup_enabled),
            pickup_instructions: pickup_enabled ? (pickup_instructions || null) : null,
            damaged_claim_window_days: damagedClaimDays,
            support_contact_method,
            support_contact_value: String(support_contact_value).trim(),
            is_published: is_published !== false,
        };

        const { data: upserted, error: upsertError } = await supabaseAdmin
            .from('seller_store_policies')
            .upsert(payload, { onConflict: 'seller_id,shop_id' })
            .select('id, seller_id, shop_id, preset, cancellation_window_hours, delivery_min_days, delivery_max_days, pickup_enabled, pickup_instructions, damaged_claim_window_days, support_contact_method, support_contact_value, is_published, created_at, updated_at')
            .single();

        if (upsertError) {
            console.error('Error upserting seller store policies:', upsertError);
            return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour des règles.' });
        }

        return res.status(200).json({ success: true, policy: upserted });
    } catch (error) {
        console.error('Update seller store policies error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

module.exports = router;
