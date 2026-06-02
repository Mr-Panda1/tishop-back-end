const express = require('express');
const router = express.Router();
const { supabase } = require('../../db/supabase');
const { authenticateAdmin, requireRole } = require('../../middlewares/adminAuthMiddleware');
const { decryptFields } = require('../../utils/encryption');

const SELLER_ENCRYPTED_FIELDS = ['first_name', 'last_name', 'phone', 'email'];
const LIVE_WINDOW_SECONDS = 120;

const tableExistsError = (error) => error?.code === '42P01';

const safeMetadata = (metadata) => {
    if (metadata && typeof metadata === 'object') return metadata;
    return {};
};

const parsePlatform = (value) => {
    const platform = String(value || 'unknown').toLowerCase();
    if (['seller', 'website', 'pwa'].includes(platform)) return platform;
    return 'unknown';
};

const parsePlatformFilter = (value) => {
    const v = String(value || 'all').toLowerCase();
    if (['all', 'seller', 'website', 'pwa'].includes(v)) return v;
    return 'all';
};

router.get('/admin/live-users',
    authenticateAdmin,
    requireRole(['CEO', 'Manager', 'Admin']),
    async (req, res) => {
        try {
            const platformFilter = parsePlatformFilter(req.query?.platform);
            const sinceIso = new Date(Date.now() - LIVE_WINDOW_SECONDS * 1000).toISOString();

            let query = supabase
                .from('app_events')
                .select('session_id, user_id, seller_id, platform, source, path, referrer, metadata, created_at')
                .gte('created_at', sinceIso)
                .order('created_at', { ascending: false });

            if (platformFilter !== 'all') {
                query = query.eq('platform', platformFilter);
            }

            const { data: rows, error } = await query;

            if (error) {
                if (tableExistsError(error)) {
                    return res.status(200).json({
                        success: true,
                        platform_filter: platformFilter,
                        summary: {
                            total_live_users: 0,
                            seller_live_users: 0,
                            website_live_users: 0,
                            pwa_live_users: 0,
                        },
                        users: [],
                    });
                }

                console.error('Live users query error:', error);
                return res.status(500).json({ success: false, message: 'Failed to load live users.' });
            }

            const latestBySession = new Map();
            (rows || []).forEach((row) => {
                if (!row.session_id) return;
                if (!latestBySession.has(row.session_id)) {
                    latestBySession.set(row.session_id, row);
                }
            });

            const latestRows = Array.from(latestBySession.values());
            const sellerIds = Array.from(new Set(latestRows.map((row) => row.seller_id).filter(Boolean)));

            let sellerMap = new Map();
            let shopMap = new Map();

            if (sellerIds.length > 0) {
                const [sellerResult, shopResult] = await Promise.all([
                    supabase
                        .from('sellers')
                        .select('id, first_name, last_name')
                        .in('id', sellerIds),
                    supabase
                        .from('shops')
                        .select('id, seller_id, name')
                        .in('seller_id', sellerIds),
                ]);

                if (sellerResult.error) {
                    console.error('Live users seller lookup error:', sellerResult.error);
                } else {
                    sellerMap = new Map((sellerResult.data || []).map((seller) => {
                        const decrypted = decryptFields(seller, SELLER_ENCRYPTED_FIELDS);
                        return [decrypted.id, decrypted];
                    }));
                }

                if (shopResult.error) {
                    console.error('Live users shop lookup error:', shopResult.error);
                } else {
                    shopMap = new Map((shopResult.data || []).map((shop) => [shop.seller_id, shop.name]));
                }
            }

            const users = latestRows.map((row) => {
                const metadata = safeMetadata(row?.metadata);
                const seller = row?.seller_id ? sellerMap.get(row.seller_id) : null;
                const sellerName = seller
                    ? `${seller.first_name || ''} ${seller.last_name || ''}`.trim() || 'Vendeur'
                    : 'Vendeur';

                return {
                    seller_id: row?.seller_id || null,
                    session_id: row?.session_id || null,
                    seller_name: sellerName,
                    shop_name: (row?.seller_id && shopMap.get(row.seller_id)) || 'Boutique',
                    platform: parsePlatform(row?.platform || metadata.platform || 'unknown'),
                    current_path: String(row?.path || metadata.path || metadata.page || '/'),
                    source: String(row?.source || metadata.utm_source || metadata.source || 'direct'),
                    referrer: String(row?.referrer || metadata.referrer || ''),
                    last_seen_at: row?.created_at,
                };
            });

            const summary = users.reduce((acc, user) => {
                acc.total_live_users += 1;
                if (user.platform === 'seller') acc.seller_live_users += 1;
                if (user.platform === 'website') acc.website_live_users += 1;
                if (user.platform === 'pwa') acc.pwa_live_users += 1;
                return acc;
            }, {
                total_live_users: 0,
                seller_live_users: 0,
                website_live_users: 0,
                pwa_live_users: 0,
            });

            return res.status(200)
                .set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
                .json({ success: true, platform_filter: platformFilter, summary, users });
        } catch (queryError) {
            console.error('Admin live users error:', queryError);
            return res.status(500).json({ success: false, message: 'Unable to load live users.' });
        }
    }
);

module.exports = router;
