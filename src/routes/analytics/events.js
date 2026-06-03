const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../../db/supabase');

const ALLOWED_EVENTS = new Set([
    'page_view',
    'heartbeat',
    'link_click',
    'product_view',
    'add_to_cart',
    'checkout_started',
    'order_paid',
    'signup_started',
    'signup_completed',
    'seller_cta_clicked',
]);
const ALLOWED_PLATFORMS = new Set(['website', 'pwa', 'seller']);

const safeString = (value, max = 255) => {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    return normalized.slice(0, max);
};

const safePath = (value) => safeString(value, 1024);

const ensureMetadata = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
};

router.post('/analytics/events', async (req, res) => {
    try {
        const eventType = safeString(req.body?.event_type, 80);
        const platform = safeString(req.body?.platform, 40);

        if (!eventType || !ALLOWED_EVENTS.has(eventType)) {
            return res.status(400).json({ success: false, message: 'Invalid event_type.' });
        }

        if (!platform || !ALLOWED_PLATFORMS.has(platform)) {
            return res.status(400).json({ success: false, message: 'Invalid platform.' });
        }

        const metadata = ensureMetadata(req.body?.metadata);

        const payload = {
            event_type: eventType,
            platform,
            session_id: safeString(req.body?.session_id, 128),
            user_id: safeString(req.body?.user_id, 128),
            seller_id: safeString(req.body?.seller_id, 128),
            source: safeString(req.body?.source || req.body?.utm_source, 120),
            utm_campaign: safeString(req.body?.utm_campaign, 255),
            path: safePath(req.body?.path),
            referrer: safePath(req.body?.referrer),
            metadata,
            created_at: new Date().toISOString(),
        };

        const { error } = await supabaseAdmin
            .from('app_events')
            .insert(payload);

        if (error) {
            if (error.code === '42P01') {
                return res.status(202).json({ success: true, message: 'Analytics table not ready.' });
            }

            console.error('Analytics event insert error:', error);
            return res.status(500).json({ success: false, message: 'Unable to store analytics event.' });
        }

        return res.status(201).json({ success: true });
    } catch (error) {
        console.error('Analytics event route error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

module.exports = router;
