const express = require('express');
const router = express.Router();
const { supabase } = require('../../db/supabase');
const { authenticateAdmin, requireRole } = require('../../middlewares/adminAuthMiddleware');
const { decryptFields } = require('../../utils/encryption');

const SELLER_ENCRYPTED_FIELDS = ['first_name', 'last_name', 'phone', 'email'];

const deriveSellerStatus = (seller) => {
    if (seller?.verification_status === 'approved' && seller?.is_verified) return 'active';
    if (seller?.verification_status === 'rejected') return 'suspended';
    return 'pending';
};

router.get('/admin/sellers',
    authenticateAdmin,
    requireRole(['CEO', 'Manager', 'Admin']),
    async (req, res) => {
        try {
            const { data: sellers, error: sellersError } = await supabase
                .from('sellers')
                .select('id, user_id, first_name, last_name, email, phone, is_verified, verification_status, created_at')
                .order('created_at', { ascending: false });

            if (sellersError) {
                console.error('Admin sellers query error:', sellersError);
                return res.status(500).json({ success: false, message: 'Failed to load sellers.' });
            }

            const decryptedSellers = (sellers || []).map((seller) => ({
                ...decryptFields(seller, SELLER_ENCRYPTED_FIELDS),
            }));

            const sellerIds = decryptedSellers.map((seller) => seller.id).filter(Boolean);

            let shopRows = [];
            let sellerOrderRows = [];

            if (sellerIds.length > 0) {
                const [shopsResult, sellerOrdersResult] = await Promise.all([
                    supabase
                        .from('shops')
                        .select('id, seller_id, name')
                        .in('seller_id', sellerIds),
                    supabase
                        .from('seller_orders')
                        .select('id, seller_id, total_amount, status')
                        .in('seller_id', sellerIds),
                ]);

                if (shopsResult.error) {
                    console.error('Admin sellers shops query error:', shopsResult.error);
                    return res.status(500).json({ success: false, message: 'Failed to load seller shops.' });
                }

                if (sellerOrdersResult.error) {
                    console.error('Admin sellers orders query error:', sellerOrdersResult.error);
                    return res.status(500).json({ success: false, message: 'Failed to load seller orders.' });
                }

                shopRows = shopsResult.data || [];
                sellerOrderRows = sellerOrdersResult.data || [];
            }

            const shopsBySellerId = shopRows.reduce((acc, shop) => {
                if (!acc[shop.seller_id]) {
                    acc[shop.seller_id] = [];
                }
                acc[shop.seller_id].push(shop);
                return acc;
            }, {});

            const orderStatsBySellerId = sellerOrderRows.reduce((acc, order) => {
                if (!acc[order.seller_id]) {
                    acc[order.seller_id] = {
                        totalOrders: 0,
                        totalRevenue: 0,
                    };
                }

                if (order.status !== 'cancelled') {
                    acc[order.seller_id].totalOrders += 1;
                    acc[order.seller_id].totalRevenue += Number(order.total_amount || 0);
                }

                return acc;
            }, {});

            const data = decryptedSellers.map((seller) => {
                const sellerShops = shopsBySellerId[seller.id] || [];
                const stats = orderStatsBySellerId[seller.id] || { totalOrders: 0, totalRevenue: 0 };
                const status = deriveSellerStatus(seller);

                return {
                    id: seller.id,
                    name: `${seller.first_name || ''} ${seller.last_name || ''}`.trim() || 'Nom non renseigné',
                    email: seller.email || '',
                    phone: seller.phone || '',
                    shopName: sellerShops[0]?.name || 'Aucune boutique',
                    shopNames: sellerShops.map((shop) => shop.name).filter(Boolean),
                    status,
                    kycVerified: Boolean(seller.is_verified),
                    joinedAt: seller.created_at,
                    totalOrders: stats.totalOrders,
                    totalRevenue: stats.totalRevenue,
                    verificationStatus: seller.verification_status || 'pending',
                    isActive: status === 'active',
                };
            });

            return res.status(200)
                .set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
                .json({
                    success: true,
                    count: data.length,
                    data,
                });
        } catch (error) {
            console.error('Admin sellers fetch error:', error);
            return res.status(500).json({ success: false, message: 'Unable to load sellers.' });
        }
    }
);

module.exports = router;