const express = require('express');
const router = express.Router();
const { supabase } = require('../../db/supabase');
const { authenticateAdmin, requireRole } = require('../../middlewares/adminAuthMiddleware');
const { decryptFields } = require('../../utils/encryption');
const { sendSellerProductDeletedByAdminEmail } = require('../../email/notifications/lifecycleNotifications');

const SELLER_ENCRYPTED_FIELDS = ['first_name', 'last_name', 'phone', 'email'];
const BUCKET_NAME = 'sellers_public';
const STORAGE_LIST_PAGE_SIZE = 100;

async function collectStorageFilePaths(prefix) {
    const filePaths = [];
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .storage
            .from(BUCKET_NAME)
            .list(prefix, {
                limit: STORAGE_LIST_PAGE_SIZE,
                offset,
                sortBy: { column: 'name', order: 'asc' },
            });

        if (error) {
            throw error;
        }

        if (!data || data.length === 0) {
            break;
        }

        for (const entry of data) {
            if (!entry?.name) {
                continue;
            }

            const entryPath = `${prefix}/${entry.name}`;

            if (entry.id === null) {
                filePaths.push(...await collectStorageFilePaths(entryPath));
                continue;
            }

            filePaths.push(entryPath);
        }

        if (data.length < STORAGE_LIST_PAGE_SIZE) {
            break;
        }

        offset += data.length;
    }

    return filePaths;
}

async function clearProductStoragePrefix(shopId, productId) {
    const prefix = `products/${shopId}/${productId}`;
    const filePaths = await collectStorageFilePaths(prefix);

    if (filePaths.length === 0) {
        return 0;
    }

    const uniquePaths = [...new Set(filePaths)];
    const { error: removeError } = await supabase
        .storage
        .from(BUCKET_NAME)
        .remove(uniquePaths);

    if (removeError) {
        throw removeError;
    }

    return uniquePaths.length;
}

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

router.get('/admin/sellers/:sellerId/products',
    authenticateAdmin,
    requireRole(['CEO', 'Manager', 'Admin']),
    async (req, res) => {
        try {
            const { sellerId } = req.params;

            const { data: seller, error: sellerError } = await supabase
                .from('sellers')
                .select('id')
                .eq('id', sellerId)
                .maybeSingle();

            if (sellerError) {
                console.error('Admin seller products seller lookup error:', sellerError);
                return res.status(500).json({ success: false, message: 'Failed to load seller data.' });
            }

            if (!seller) {
                return res.status(404).json({ success: false, message: 'Seller not found.' });
            }

            const { data: shops, error: shopsError } = await supabase
                .from('shops')
                .select('id, name')
                .eq('seller_id', sellerId);

            if (shopsError) {
                console.error('Admin seller products shops query error:', shopsError);
                return res.status(500).json({ success: false, message: 'Failed to load seller shops.' });
            }

            const shopIds = (shops || []).map((shop) => shop.id).filter(Boolean);
            if (shopIds.length === 0) {
                return res.status(200).json({ success: true, count: 0, data: [] });
            }

            const { data: products, error: productsError } = await supabase
                .from('products')
                .select(`
                    id,
                    name,
                    status,
                    price,
                    stock,
                    created_at,
                    shop_id,
                    images:product_images(image_url, position, is_main)
                `)
                .in('shop_id', shopIds)
                .order('created_at', { ascending: false });

            if (productsError) {
                console.error('Admin seller products query error:', productsError);
                return res.status(500).json({ success: false, message: 'Failed to load seller products.' });
            }

            const shopsById = (shops || []).reduce((acc, shop) => {
                acc[shop.id] = shop;
                return acc;
            }, {});

            const data = (products || []).map((product) => {
                const sortedImages = [...(product.images || [])].sort((a, b) => {
                    if (a.is_main && !b.is_main) return -1;
                    if (!a.is_main && b.is_main) return 1;
                    return (a.position || 0) - (b.position || 0);
                });

                return {
                    id: product.id,
                    name: product.name,
                    status: product.status,
                    price: Number(product.price || 0),
                    stock: Number(product.stock || 0),
                    createdAt: product.created_at,
                    shopId: product.shop_id,
                    shopName: shopsById[product.shop_id]?.name || 'Boutique inconnue',
                    imageUrl: sortedImages[0]?.image_url || null,
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
            console.error('Admin seller products fetch error:', error);
            return res.status(500).json({ success: false, message: 'Unable to load seller products.' });
        }
    }
);

router.delete('/admin/sellers/:sellerId/products/:productId',
    authenticateAdmin,
    requireRole(['CEO', 'Manager', 'Admin']),
    async (req, res) => {
        try {
            const { sellerId, productId } = req.params;
            const reason = String(req.body?.reason || '').trim();

            if (!reason) {
                return res.status(400).json({ success: false, message: 'Une raison de suppression est requise.' });
            }

            const { data: productData, error: productFetchError } = await supabase
                .from('products')
                .select('id, name, shop:shops!inner(id, seller_id)')
                .eq('id', productId)
                .maybeSingle();

            if (productFetchError) {
                console.error('Admin seller product fetch error:', productFetchError);
                return res.status(500).json({ success: false, message: 'Failed to load product.' });
            }

            if (!productData) {
                return res.status(404).json({ success: false, message: 'Product not found.' });
            }

            if (!productData.shop || productData.shop.seller_id !== sellerId) {
                return res.status(403).json({ success: false, message: 'Product does not belong to the selected seller.' });
            }

            const { data: sellerData, error: sellerFetchError } = await supabase
                .from('sellers')
                .select('first_name, last_name, email')
                .eq('id', sellerId)
                .maybeSingle();

            if (sellerFetchError) {
                console.error('Admin seller email lookup error:', sellerFetchError);
                return res.status(500).json({ success: false, message: 'Failed to load seller contact information.' });
            }

            const sellerSnapshot = sellerData
                ? decryptFields(sellerData, SELLER_ENCRYPTED_FIELDS)
                : null;

            if (!sellerSnapshot?.email) {
                return res.status(400).json({ success: false, message: 'Seller email introuvable pour la notification.' });
            }

            const { data: orderItems, error: orderCheckError } = await supabase
                .from('order_items')
                .select('id')
                .eq('product_id', productId)
                .limit(1);

            if (orderCheckError) {
                console.error('Admin seller product orders check error:', orderCheckError);
                return res.status(500).json({ success: false, message: 'Failed to validate existing orders.' });
            }

            if (orderItems && orderItems.length > 0) {
                return res.status(400).json({
                    success: false,
                    hasOrders: true,
                    message: 'Impossible de supprimer ce produit car des commandes existent déjà.',
                });
            }

            let deletedStorageObjectsCount = 0;
            try {
                deletedStorageObjectsCount = await clearProductStoragePrefix(productData.shop.id, productId);
            } catch (storageCleanupError) {
                console.error('Admin seller product storage cleanup error:', storageCleanupError);
                return res.status(500).json({ success: false, message: 'Failed to delete product files from storage.' });
            }

            const { data: variantImages, error: variantImagesFetchError } = await supabase
                .from('product_variant_images')
                .select('id, variant:product_variants!inner(product_id)')
                .eq('variant.product_id', productId);

            if (variantImagesFetchError) {
                console.error('Admin seller product variant images fetch error:', variantImagesFetchError);
                return res.status(500).json({ success: false, message: 'Failed to load product variant images.' });
            }

            if (variantImages && variantImages.length > 0) {
                const variantImageIds = variantImages.map((image) => image.id);
                const { error: variantImagesDeleteError } = await supabase
                    .from('product_variant_images')
                    .delete()
                    .in('id', variantImageIds);

                if (variantImagesDeleteError) {
                    console.error('Admin seller product variant images delete error:', variantImagesDeleteError);
                    return res.status(500).json({ success: false, message: 'Failed to delete product variant images.' });
                }
            }

            const { error: variantsDeleteError } = await supabase
                .from('product_variants')
                .delete()
                .eq('product_id', productId);

            if (variantsDeleteError) {
                console.error('Admin seller product variants delete error:', variantsDeleteError);
                return res.status(500).json({ success: false, message: 'Failed to delete product variants.' });
            }

            const { data: productImages, error: productImagesFetchError } = await supabase
                .from('product_images')
                .select('id')
                .eq('product_id', productId);

            if (productImagesFetchError) {
                console.error('Admin seller product images fetch error:', productImagesFetchError);
                return res.status(500).json({ success: false, message: 'Failed to load product images.' });
            }

            if (productImages && productImages.length > 0) {
                const productImageIds = productImages.map((image) => image.id);
                const { error: productImagesDeleteError } = await supabase
                    .from('product_images')
                    .delete()
                    .in('id', productImageIds);

                if (productImagesDeleteError) {
                    console.error('Admin seller product images delete error:', productImagesDeleteError);
                    return res.status(500).json({ success: false, message: 'Failed to delete product images.' });
                }
            }

            const { error: productDeleteError } = await supabase
                .from('products')
                .delete()
                .eq('id', productId);

            if (productDeleteError) {
                console.error('Admin seller product delete error:', productDeleteError);
                return res.status(500).json({ success: false, message: 'Failed to delete product.' });
            }

            const sellerName = `${sellerSnapshot.first_name || ''} ${sellerSnapshot.last_name || ''}`.trim() || 'Vendeur';
            let emailSent = false;

            try {
                await sendSellerProductDeletedByAdminEmail({
                    toEmail: sellerSnapshot.email,
                    sellerName,
                    productName: productData.name,
                    reason,
                });
                emailSent = true;
            } catch (emailError) {
                console.error('Admin seller product deleted email error:', emailError);
            }

            return res.status(200).json({
                success: true,
                message: 'Produit supprimé avec succès.',
                deletedProductId: productId,
                deletedStorageObjectsCount,
                emailSent,
                emailRecipient: sellerSnapshot.email,
            });
        } catch (error) {
            console.error('Admin seller product delete exception:', error);
            return res.status(500).json({ success: false, message: 'Unable to delete product.' });
        }
    }
);

module.exports = router;