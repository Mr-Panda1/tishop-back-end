const express = require('express');
const router = express.Router();
const { supabase } = require('../../db/supabase');
const { authenticateAdmin, requireRole } = require('../../middlewares/adminAuthMiddleware');

const MAX_HOURS = 24 * 30;
const DEFAULT_HOURS = 24 * 7;
const SUPPORTED_ORDER_STATUSES = new Set(['paid', 'confirmed', 'shipped', 'delivered']);
const LIVE_WINDOW_SECONDS = 120;

const parseHours = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_HOURS;
    return Math.min(parsed, MAX_HOURS);
};

const tableExistsError = (error) => error?.code === '42P01';

const safeCount = async ({ table, filters = [] }) => {
    let query = supabase.from(table).select('id', { count: 'exact', head: true });
    filters.forEach((filter) => {
        if (filter.type === 'eq') query = query.eq(filter.column, filter.value);
        if (filter.type === 'gte') query = query.gte(filter.column, filter.value);
    });

    const { count, error } = await query;
    if (error) {
        if (tableExistsError(error)) return 0;
        throw error;
    }

    return Number(count || 0);
};

const getEventRows = async (sinceIso) => {
    const { data, error } = await supabase
        .from('app_events')
        .select('event_type, platform, source, utm_campaign, session_id, user_id, path, metadata, created_at')
        .gte('created_at', sinceIso);

    if (error) {
        if (tableExistsError(error)) {
            return [];
        }
        throw error;
    }

    return data || [];
};

const isHomepagePath = (path) => {
    if (!path) return false;
    const normalized = String(path).trim();
    return normalized === '/' || normalized.startsWith('/?');
};

const isSignupPath = (path) => {
    if (!path) return false;
    const normalized = String(path).trim().toLowerCase();
    return normalized.startsWith('/auth/signup');
};

const isSellerCtaHref = (href) => {
    if (!href) return false;
    const normalized = String(href).trim().toLowerCase();
    return normalized.includes('seller.tishop.co') && normalized.includes('/auth/signup');
};

const countUniqueSessions = (rows, predicate) => {
    const sessions = new Set();
    rows.forEach((row) => {
        if (!predicate(row)) return;
        const key = row.session_id || row.user_id;
        if (key) sessions.add(key);
    });
    return sessions.size;
};

const buildFunnels = (rows) => {
    const isSellerPlatform = (platform) => {
        const normalized = String(platform || '').toLowerCase();
        return normalized === 'seller' || normalized === 'website';
    };

    const sellerSteps = [
        {
            key: 'homepage',
            label: 'Seller homepage',
            users: countUniqueSessions(rows, (row) => isSellerPlatform(row.platform) && row.event_type === 'page_view' && isHomepagePath(row.path)),
        },
        {
            key: 'become_seller_click',
            label: 'Become seller click (PWA)',
            users: countUniqueSessions(rows, (row) => {
                if (row.platform !== 'pwa') return false;
                if (row.event_type === 'seller_cta_clicked') return true;
                if (row.event_type !== 'link_click') return false;
                return isSellerCtaHref(row.metadata?.href);
            }),
        },
        {
            key: 'signup_started',
            label: 'Signup started',
            users: countUniqueSessions(rows, (row) =>
                isSellerPlatform(row.platform) && (
                    row.event_type === 'signup_started' ||
                    (row.event_type === 'page_view' && isSignupPath(row.path))
                )
            ),
        },
        {
            key: 'signup_completed',
            label: 'Signup completed',
            users: countUniqueSessions(rows, (row) => isSellerPlatform(row.platform) && row.event_type === 'signup_completed'),
        },
    ];

    const buyerSteps = [
        {
            key: 'homepage',
            label: 'Buyer homepage',
            users: countUniqueSessions(rows, (row) => row.platform === 'pwa' && row.event_type === 'page_view' && isHomepagePath(row.path)),
        },
        {
            key: 'product_view',
            label: 'Product viewed',
            users: countUniqueSessions(rows, (row) => row.platform === 'pwa' && row.event_type === 'product_view'),
        },
        {
            key: 'add_to_cart',
            label: 'Added to cart',
            users: countUniqueSessions(rows, (row) => row.platform === 'pwa' && row.event_type === 'add_to_cart'),
        },
        {
            key: 'checkout_started',
            label: 'Checkout started',
            users: countUniqueSessions(rows, (row) => row.platform === 'pwa' && row.event_type === 'checkout_started'),
        },
        {
            key: 'order_paid',
            label: 'Order paid',
            users: countUniqueSessions(rows, (row) => row.platform === 'pwa' && row.event_type === 'order_paid'),
        },
    ];

    const withRates = (steps) => {
        if (!steps.length) return [];

        return steps.map((step, index) => {
            const previousUsers = index > 0 ? steps[index - 1].users : null;
            const firstUsers = steps[0].users;

            const fromPreviousRate = previousUsers && previousUsers > 0
                ? Number(((step.users / previousUsers) * 100).toFixed(2))
                : index === 0
                    ? 100
                    : 0;

            const fromStartRate = firstUsers > 0
                ? Number(((step.users / firstUsers) * 100).toFixed(2))
                : 0;

            return {
                ...step,
                from_previous_rate: fromPreviousRate,
                from_start_rate: fromStartRate,
            };
        });
    };

    return {
        seller: withRates(sellerSteps),
        buyer: withRates(buyerSteps),
    };
};

const buildAggregates = (rows) => {
    const sourceMap = new Map();
    const campaignMap = new Map();

    const sessions = new Set();
    const visitors = new Set();
    const liveSessions = new Set();

    const nowMs = Date.now();
    const liveWindowMs = 2 * 60 * 1000;

    rows.forEach((row) => {
        const source = String(row.source || 'direct').toLowerCase();
        const campaign = String(row.utm_campaign || 'organic');
        const sessionKey = row.session_id || null;
        const visitorKey = row.user_id || row.session_id || null;

        if (sessionKey) sessions.add(sessionKey);
        if (visitorKey) visitors.add(visitorKey);

        if (row.created_at) {
            const createdMs = new Date(row.created_at).getTime();
            if (Number.isFinite(createdMs) && nowMs - createdMs <= liveWindowMs && sessionKey) {
                liveSessions.add(sessionKey);
            }
        }

        if (!sourceMap.has(source)) {
            sourceMap.set(source, { source, sessions: new Set(), orders: 0 });
        }

        if (sessionKey) {
            sourceMap.get(source).sessions.add(sessionKey);
        }

        if (row.event_type === 'order_paid') {
            sourceMap.get(source).orders += 1;
        }

        if (!campaignMap.has(campaign)) {
            campaignMap.set(campaign, { campaign, sessions: new Set(), orders: 0 });
        }

        if (sessionKey) {
            campaignMap.get(campaign).sessions.add(sessionKey);
        }

        if (row.event_type === 'order_paid') {
            campaignMap.get(campaign).orders += 1;
        }
    });

    const sources = Array.from(sourceMap.values())
        .map((item) => {
            const sessionCount = item.sessions.size;
            return {
                source: item.source,
                sessions: sessionCount,
                orders: item.orders,
                conversion_rate: sessionCount > 0 ? (item.orders / sessionCount) * 100 : 0,
            };
        })
        .sort((a, b) => b.sessions - a.sessions);

    const campaigns = Array.from(campaignMap.values())
        .map((item) => {
            const sessionCount = item.sessions.size;
            return {
                campaign: item.campaign,
                sessions: sessionCount,
                orders: item.orders,
                conversion_rate: sessionCount > 0 ? (item.orders / sessionCount) * 100 : 0,
            };
        })
        .sort((a, b) => b.sessions - a.sessions);

    return {
        sessions: sessions.size,
        uniqueVisitors: visitors.size,
        activeLiveUsers: liveSessions.size,
        sources,
        campaigns,
    };
};

router.get('/admin/analytics/summary',
    authenticateAdmin,
    requireRole(['CEO', 'Manager', 'Admin']),
    async (req, res) => {
        try {
            const hours = parseHours(req.query?.hours);
            const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

            const { data: orders, error: ordersError } = await supabase
                .from('orders')
                .select('id, total_amount, status, payment_method, created_at')
                .gte('created_at', sinceIso);

            if (ordersError) {
                console.error('Error loading orders analytics:', ordersError);
                return res.status(500).json({ success: false, message: 'Failed to load order analytics.' });
            }

            const orderRows = orders || [];
            const paidOrders = orderRows.filter((order) => {
                return SUPPORTED_ORDER_STATUSES.has(String(order.status || '').toLowerCase());
            });

            const paidRevenue = paidOrders.reduce((sum, row) => {
                const value = Number(row.total_amount || 0);
                return sum + (Number.isFinite(value) ? value : 0);
            }, 0);

            const events = await getEventRows(sinceIso);
            const aggregates = buildAggregates(events);
            const funnels = buildFunnels(events);

            const sessionCount = aggregates.sessions || orderRows.length;
            const orderCount = orderRows.length;
            const conversionRate = sessionCount > 0 ? (orderCount / sessionCount) * 100 : 0;

            return res.status(200)
                .set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
                .json({
                    success: true,
                    range_hours: hours,
                    summary: {
                        sessions: sessionCount,
                        unique_visitors: aggregates.uniqueVisitors || sessionCount,
                        orders: orderCount,
                        conversion_rate: Number(conversionRate.toFixed(2)),
                        paid_orders: paidOrders.length,
                        paid_revenue: Number(paidRevenue.toFixed(2)),
                        active_live_users: aggregates.activeLiveUsers,
                    },
                    sources: aggregates.sources,
                    campaigns: aggregates.campaigns,
                    funnels,
                });
        } catch (error) {
            console.error('Admin analytics summary error:', error);
            return res.status(500).json({ success: false, message: 'Unable to load analytics summary.' });
        }
    }
);

router.get('/admin/overview',
    authenticateAdmin,
    requireRole(['CEO', 'Manager', 'Admin']),
    async (req, res) => {
        try {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);

            const since24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const sinceLiveIso = new Date(Date.now() - LIVE_WINDOW_SECONDS * 1000).toISOString();

            const [activeSellers, pendingKyc, ordersToday, sessions24h, sellerLive] = await Promise.all([
                safeCount({ table: 'sellers' }),
                safeCount({
                    table: 'kyc_documents',
                    filters: [{ type: 'eq', column: 'status', value: 'pending' }],
                }),
                safeCount({
                    table: 'orders',
                    filters: [{ type: 'gte', column: 'created_at', value: startOfDay.toISOString() }],
                }),
                (async () => {
                    const { data, error } = await supabase
                        .from('app_events')
                        .select('session_id')
                        .gte('created_at', since24hIso);

                    if (error) {
                        if (tableExistsError(error)) return 0;
                        throw error;
                    }

                    return new Set((data || []).map((row) => row.session_id).filter(Boolean)).size;
                })(),
                (async () => {
                    const { data, error } = await supabase
                        .from('app_events')
                        .select('session_id')
                        .eq('platform', 'seller')
                        .gte('created_at', sinceLiveIso);

                    if (error) {
                        if (tableExistsError(error)) return 0;
                        throw error;
                    }

                    return new Set((data || []).map((row) => row.session_id).filter(Boolean)).size;
                })(),
            ]);

            return res.status(200)
                .set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
                .json({
                    success: true,
                    data: {
                        active_sellers: activeSellers,
                        pending_kyc: pendingKyc,
                        orders_today: ordersToday,
                        traffic_24h_sessions: sessions24h,
                        seller_live_users: sellerLive,
                    },
                });
        } catch (error) {
            console.error('Admin overview error:', error);
            return res.status(500).json({ success: false, message: 'Unable to load overview metrics.' });
        }
    }
);

module.exports = router;
