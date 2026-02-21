const express = require('express');
const router = express.Router();
const { supabase } = require('../../db/supabase');

const buildOrderNumber = () => {
    const now = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const randomPart = Math.floor(100000 + Math.random() * 900000);
    return `TS-${datePart}-${randomPart}`;
};

// Customer place an order
router.post('/create-order', async (req, res) => {
    try {
        const {
            customerName,
            customerEmail,
            customerPhone,
            departmentId,
            arrondissementId,
            communeId,
            neighborhood,
            landmark,
            deliveryMethod = 'delivery',
            cartItems
        } = req.body;

        if (!customerName || !customerEmail || !customerPhone) {
            return res.status(400).json({ message: 'Customer name, email, and phone are required' });
        }

        if (!departmentId || !arrondissementId || !communeId || !landmark) {
            return res.status(400).json({ message: 'Delivery location details are required' });
        }

        if (!Array.isArray(cartItems) || cartItems.length === 0) {
            return res.status(400).json({ message: 'Cart items are required' });
        }

        const productIds = [...new Set(cartItems.map(item => item.productId).filter(Boolean))];
        if (productIds.length === 0) {
            return res.status(400).json({ message: 'Cart items must include productId' });
        }

        const variantIds = [...new Set(cartItems.map(item => item.productVariantId).filter(Boolean))];

        const { data: products, error: productsError } = await supabase
            .from('products')
            .select('id, shop_id, price, stock, has_variants')
            .in('id', productIds);

        if (productsError) {
            console.error('Error fetching products:', productsError);
            return res.status(500).json({ message: 'Error fetching products' });
        }

        if (!products || products.length === 0) {
            return res.status(400).json({ message: 'No valid products found in cart' });
        }

        let variants = [];
        if (variantIds.length > 0) {
            const { data: variantsData, error: variantsError } = await supabase
                .from('product_variants')
                .select('id, product_id, price, stock')
                .in('id', variantIds);

            if (variantsError) {
                console.error('Error fetching variants:', variantsError);
                return res.status(500).json({ message: 'Error fetching product variants' });
            }
            variants = variantsData || [];
        }

        const productMap = new Map(products.map(product => [product.id, product]));
        const variantMap = new Map(variants.map(variant => [variant.id, variant]));

        const normalizedItems = [];
        for (const item of cartItems) {
            const product = productMap.get(item.productId);
            if (!product) {
                return res.status(400).json({ message: `Product not found for id ${item.productId}` });
            }

            const quantity = parseInt(item.quantity, 10);
            if (!Number.isInteger(quantity) || quantity <= 0) {
                return res.status(400).json({ message: 'Invalid quantity in cart items' });
            }

            let unitPrice = product.price;
            let variantId = null;

            if (item.productVariantId) {
                const variant = variantMap.get(item.productVariantId);
                if (!variant || variant.product_id !== product.id) {
                    return res.status(400).json({ message: 'Invalid product variant for cart item' });
                }
                variantId = variant.id;
                unitPrice = variant.price ?? product.price;

                if (variant.stock !== null && variant.stock < quantity) {
                    return res.status(400).json({ message: 'Insufficient stock for selected variant' });
                }
            } else if (product.has_variants) {
                return res.status(400).json({ message: 'Variant is required for this product' });
            } else if (product.stock !== null && product.stock < quantity) {
                return res.status(400).json({ message: 'Insufficient stock for selected product' });
            }

            normalizedItems.push({
                productId: product.id,
                productVariantId: variantId,
                shopId: product.shop_id,
                quantity,
                unitPrice,
                lineTotal: unitPrice * quantity
            });
        }

        const shopIds = [...new Set(normalizedItems.map(item => item.shopId))];

        const { data: shops, error: shopsError } = await supabase
            .from('shops')
            .select('id, seller_id')
            .in('id', shopIds);

        if (shopsError) {
            console.error('Error fetching shops:', shopsError);
            return res.status(500).json({ message: 'Error fetching shops' });
        }

        const shopMap = new Map((shops || []).map(shop => [shop.id, shop]));
        if (shopMap.size !== shopIds.length) {
            return res.status(400).json({ message: 'One or more shops could not be resolved for the cart' });
        }

        const { data: deliveryOptions, error: deliveryError } = await supabase
            .from('delivery_options')
            .select('id, shop_id, price, estimated_days, is_active')
            .in('shop_id', shopIds)
            .eq('commune_id', communeId)
            .eq('is_active', true);

        if (deliveryError) {
            console.error('Error fetching delivery options:', deliveryError);
            return res.status(500).json({ message: 'Error fetching delivery options' });
        }

        const deliveryMap = new Map((deliveryOptions || []).map(option => [option.shop_id, option]));
        for (const shopId of shopIds) {
            if (!deliveryMap.has(shopId)) {
                return res.status(400).json({ message: 'One or more sellers do not deliver to the selected commune' });
            }
        }

        const sellerGroups = new Map();
        normalizedItems.forEach(item => {
            if (!sellerGroups.has(item.shopId)) {
                sellerGroups.set(item.shopId, []);
            }
            sellerGroups.get(item.shopId).push(item);
        });

        let totalAmount = 0;
        const sellerOrderPayload = [];
        const sellerSummaries = [];

        for (const [shopId, items] of sellerGroups.entries()) {
            const itemsSubtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
            const deliveryOption = deliveryMap.get(shopId);
            const deliveryFee = deliveryMethod === 'delivery' ? Number(deliveryOption.price) : 0;
            const sellerTotal = itemsSubtotal + deliveryFee;

            const shop = shopMap.get(shopId);
            sellerOrderPayload.push({
                order_id: null,
                seller_id: shop.seller_id,
                shop_id: shopId,
                delivery_method: deliveryMethod,
                delivery_option_id: deliveryOption.id,
                items_subtotal: itemsSubtotal,
                delivery_fee: deliveryFee,
                total_amount: sellerTotal,
                status: 'pending'
            });

            sellerSummaries.push({
                shopId,
                itemsSubtotal,
                deliveryFee,
                total: sellerTotal
            });

            totalAmount += sellerTotal;
        }

        const orderNumber = buildOrderNumber();
        const { data: orderData, error: orderError } = await supabase
            .from('orders')
            .insert([{
                order_number: orderNumber,
                customer_id: null,
                customer_name: customerName,
                customer_email: customerEmail,
                customer_phone: customerPhone,
                department_id: departmentId,
                arrondissement_id: arrondissementId,
                commune_id: communeId,
                neighborhood: neighborhood || null,
                landmark,
                total_amount: totalAmount,
                status: 'pending'
            }])
            .select()
            .single();

        if (orderError) {
            console.error('Error creating order:', orderError);
            return res.status(500).json({ message: 'Error creating order' });
        }

        const orderId = orderData.id;
        const sellerOrdersToInsert = sellerOrderPayload.map(payload => ({
            ...payload,
            order_id: orderId
        }));

        const { data: sellerOrders, error: sellerOrdersError } = await supabase
            .from('seller_orders')
            .insert(sellerOrdersToInsert)
            .select('id, shop_id, seller_id, items_subtotal, delivery_fee, total_amount');

        if (sellerOrdersError) {
            console.error('Error creating seller orders:', sellerOrdersError);
            return res.status(500).json({ message: 'Error creating seller orders' });
        }

        const sellerOrderMap = new Map((sellerOrders || []).map(row => [row.shop_id, row]));
        const orderItemsPayload = normalizedItems.map(item => {
            const sellerOrder = sellerOrderMap.get(item.shopId);
            return {
                order_id: orderId,
                seller_order_id: sellerOrder.id,
                product_id: item.productId,
                product_variant_id: item.productVariantId,
                quantity: item.quantity,
                unit_price: item.unitPrice,
                total_price: item.lineTotal
            };
        });

        const { error: orderItemsError } = await supabase
            .from('order_items')
            .insert(orderItemsPayload);

        if (orderItemsError) {
            console.error('Error creating order items:', orderItemsError);
            return res.status(500).json({ message: 'Error creating order items' });
        }

        return res.status(201).json({
            message: 'Order created successfully',
            data: {
                orderId,
                orderNumber,
                totalAmount,
                sellerSummaries
            }
        });
    } catch (error) {
        console.error('Create order error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// GET customer orders by email
router.get('/', async (req, res) => {
    try {
        const { email } = req.query;

        if (!email) {
            return res.status(400).json({ message: 'Email query parameter is required' });
        }

        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('id, order_number, customer_email, total_amount, status, created_at, updated_at')
            .eq('customer_email', email)
            .order('created_at', { ascending: false });

        if (ordersError) {
            console.error('Error fetching orders:', ordersError);
            return res.status(500).json({ message: 'Error fetching orders' });
        }

        if (!orders || orders.length === 0) {
            return res.status(200).json({
                message: 'No orders found',
                data: []
            });
        }

        const orderIds = orders.map(order => order.id);

        const { data: sellerOrders, error: sellerOrdersError } = await supabase
            .from('seller_orders')
            .select('id, order_id, seller_id, shop_id, items_subtotal, delivery_fee, total_amount, status, confirmed_at, shipped_at, delivered_at, delivery_code_full')
            .in('order_id', orderIds);

        if (sellerOrdersError) {
            console.error('Error fetching seller orders:', sellerOrdersError);
            return res.status(500).json({ message: 'Error fetching seller orders' });
        }

        const sellerOrderIds = (sellerOrders || []).map(so => so.id);

        let orderItems = [];
        if (sellerOrderIds.length > 0) {
            const { data: items, error: itemsError } = await supabase
                .from('order_items')
                .select('id, order_id, seller_order_id, product_id, product_variant_id, quantity, unit_price, total_price')
                .in('seller_order_id', sellerOrderIds);

            if (itemsError) {
                console.error('Error fetching order items:', itemsError);
                return res.status(500).json({ message: 'Error fetching order items' });
            }

            orderItems = items || [];
        }

        const sellerOrdersByOrderId = new Map();
        (sellerOrders || []).forEach(so => {
            if (!sellerOrdersByOrderId.has(so.order_id)) {
                sellerOrdersByOrderId.set(so.order_id, []);
            }
            sellerOrdersByOrderId.get(so.order_id).push(so);
        });

        const itemsBySellerOrderId = new Map();
        orderItems.forEach(item => {
            if (!itemsBySellerOrderId.has(item.seller_order_id)) {
                itemsBySellerOrderId.set(item.seller_order_id, []);
            }
            itemsBySellerOrderId.get(item.seller_order_id).push(item);
        });

        const productIds = [...new Set(orderItems.map(item => item.product_id))];
        const variantIds = [...new Set(orderItems.map(item => item.product_variant_id).filter(Boolean))];
        
        let products = [];
        if (productIds.length > 0) {
            const { data: productsData, error: productsError } = await supabase
                .from('products')
                .select('id, name')
                .in('id', productIds);

            if (productsError) {
                console.error('Error fetching products:', productsError);
                return res.status(500).json({ message: 'Error fetching products' });
            }

            products = productsData || [];
        }

        let variants = [];
        if (variantIds.length > 0) {
            const { data: variantsData, error: variantsError } = await supabase
                .from('product_variants')
                .select('id, sku, size, color, attributes')
                .in('id', variantIds);

            if (variantsError) {
                console.error('Error fetching variants:', variantsError);
                return res.status(500).json({ message: 'Error fetching variants' });
            }

            variants = variantsData || [];
        }

        const productMap = new Map(products.map(p => [p.id, p]));
        const variantMap = new Map(variants.map(v => [v.id, v]));
        const productImageMap = new Map();
        const variantImageMap = new Map();

        if (productIds.length > 0) {
            const { data: productImages, error: productImagesError } = await supabase
                .from('product_images')
                .select('product_id, image_url, position, is_main')
                .in('product_id', productIds);

            if (productImagesError) {
                console.error('Error fetching product images:', productImagesError);
                return res.status(500).json({ message: 'Error fetching product images' });
            }

            (productImages || []).forEach(image => {
                const existing = productImageMap.get(image.product_id);
                if (!existing || image.is_main || image.position < existing.position) {
                    productImageMap.set(image.product_id, image);
                }
            });
        }

        if (variantIds.length > 0) {
            const { data: variantImages, error: variantImagesError } = await supabase
                .from('product_variant_images')
                .select('product_variant_id, image_url, position, is_main')
                .in('product_variant_id', variantIds);

            if (variantImagesError) {
                console.error('Error fetching variant images:', variantImagesError);
                return res.status(500).json({ message: 'Error fetching variant images' });
            }

            (variantImages || []).forEach(image => {
                const existing = variantImageMap.get(image.product_variant_id);
                if (!existing || image.is_main || image.position < existing.position) {
                    variantImageMap.set(image.product_variant_id, image);
                }
            });
        }

        const result = orders.map(order => ({
            id: order.id,
            order_number: order.order_number,
            created_at: order.created_at,
            total: order.total_amount,
            seller_orders: (sellerOrdersByOrderId.get(order.id) || []).map(so => ({
                id: so.id,
                status: so.status,
                items: (itemsBySellerOrderId.get(so.id) || []).map(item => {
                    const product = productMap.get(item.product_id);
                    const variant = item.product_variant_id ? variantMap.get(item.product_variant_id) : null;
                    const variantImage = item.product_variant_id ? variantImageMap.get(item.product_variant_id) : null;
                    const productImage = variantImage || productImageMap.get(item.product_id);
                    
                    const variantLabel = variant ? [
                        variant.size && `Taille: ${variant.size}`,
                        variant.color && `Couleur: ${variant.color}`
                    ].filter(Boolean).join(' • ') : '';
                    
                    return {
                        product: {
                            name: product?.name || 'Produit',
                            image: productImage?.image_url || '',
                            variant_label: variantLabel
                        },
                        quantity: item.quantity
                    };
                })
            }))
        }));

        return res.status(200).json({
            message: 'Orders retrieved successfully',
            data: result
        });
    } catch (error) {
        console.error('Get orders error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// GET single order by ID
router.get('/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;

        // Fetch order
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .maybeSingle();

        if (orderError) {
            console.error('Error fetching order:', orderError);
            return res.status(500).json({ message: 'Error fetching order' });
        }

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Fetch seller orders
        const { data: sellerOrders, error: sellerOrdersError } = await supabase
            .from('seller_orders')
            .select('id, order_id, seller_id, shop_id, items_subtotal, delivery_fee, total_amount, status, confirmed_at, shipped_at, delivered_at, delivery_code_full')
            .eq('order_id', orderId);

        if (sellerOrdersError) {
            console.error('Error fetching seller orders:', sellerOrdersError);
            return res.status(500).json({ message: 'Error fetching seller orders' });
        }

        const sellerOrderIds = (sellerOrders || []).map(so => so.id);
        const shopIds = [...new Set((sellerOrders || []).map(so => so.shop_id))];
        
        let orderItems = [];
        let shops = [];

        // Fetch shops
        if (shopIds.length > 0) {
            const { data: shopsData } = await supabase
                .from('shops')
                .select('id, name, logo_url')
                .in('id', shopIds);
            shops = shopsData || [];
        }

        // Fetch order items
        if (sellerOrderIds.length > 0) {
            const { data: items, error: itemsError } = await supabase
                .from('order_items')
                .select('id, seller_order_id, product_id, product_variant_id, quantity, unit_price, total_price')
                .in('seller_order_id', sellerOrderIds);

            if (itemsError) {
                console.error('Error fetching order items:', itemsError);
                return res.status(500).json({ message: 'Error fetching order items' });
            }

            orderItems = items || [];
        }

        // Fetch products
        const productIds = [...new Set(orderItems.map(item => item.product_id))];
        const variantIds = [...new Set(orderItems.map(item => item.product_variant_id).filter(Boolean))];
        
        let products = [];
        if (productIds.length > 0) {
            const { data: productsData } = await supabase
                .from('products')
                .select('id, name')
                .in('id', productIds);
            products = productsData || [];
        }

        let variants = [];
        if (variantIds.length > 0) {
            const { data: variantsData } = await supabase
                .from('product_variants')
                .select('id, sku, size, color, attributes')
                .in('id', variantIds);
            variants = variantsData || [];
        }

        // Create maps for easy lookup
        const shopMap = new Map(shops.map(s => [s.id, s]));
        const productMap = new Map(products.map(p => [p.id, p]));
        const variantMap = new Map(variants.map(v => [v.id, v]));
        const productImageMap = new Map();
        const variantImageMap = new Map();

        if (productIds.length > 0) {
            const { data: productImages, error: productImagesError } = await supabase
                .from('product_images')
                .select('product_id, image_url, position, is_main')
                .in('product_id', productIds);

            if (productImagesError) {
                console.error('Error fetching product images:', productImagesError);
                return res.status(500).json({ message: 'Error fetching product images' });
            }

            (productImages || []).forEach(image => {
                const existing = productImageMap.get(image.product_id);
                if (!existing || image.is_main || image.position < existing.position) {
                    productImageMap.set(image.product_id, image);
                }
            });
        }

        if (variantIds.length > 0) {
            const { data: variantImages, error: variantImagesError } = await supabase
                .from('product_variant_images')
                .select('product_variant_id, image_url, position, is_main')
                .in('product_variant_id', variantIds);

            if (variantImagesError) {
                console.error('Error fetching variant images:', variantImagesError);
                return res.status(500).json({ message: 'Error fetching variant images' });
            }

            (variantImages || []).forEach(image => {
                const existing = variantImageMap.get(image.product_variant_id);
                if (!existing || image.is_main || image.position < existing.position) {
                    variantImageMap.set(image.product_variant_id, image);
                }
            });
        }

        // Group items by seller order
        const itemsBySellerOrderId = new Map();
        orderItems.forEach(item => {
            if (!itemsBySellerOrderId.has(item.seller_order_id)) {
                itemsBySellerOrderId.set(item.seller_order_id, []);
            }
            itemsBySellerOrderId.get(item.seller_order_id).push(item);
        });

        // Calculate totals
        const subtotal = (sellerOrders || []).reduce((sum, so) => sum + (so.items_subtotal || 0), 0);
        const totalDeliveryFee = (sellerOrders || []).reduce((sum, so) => sum + (so.delivery_fee || 0), 0);

        const result = {
            id: order.id,
            order_number: order.order_number,
            created_at: order.created_at,
            customer_name: order.customer_name,
            customer_email: order.customer_email,
            customer_phone: order.customer_phone,
            subtotal: subtotal,
            total_delivery_fee: totalDeliveryFee,
            total: order.total_amount,
            delivery_location: {
                department_id: order.department_id || '',
                arrondissement_id: order.arrondissement_id || '',
                commune_id: order.commune_id || '',
                landmark: order.landmark || '',
                neighborhood: order.neighborhood || ''
            },
            seller_orders: (sellerOrders || []).map(so => {
                const shop = shopMap.get(so.shop_id);
                return {
                    id: so.id,
                    seller_id: so.seller_id,
                    status: so.status,
                    items_subtotal: so.items_subtotal,
                    delivery_fee: so.delivery_fee,
                    total: so.total_amount,
                    delivery_code_full: so.delivery_code_full,
                    seller: {
                        store_name: shop?.name || 'Vendeur',
                        avatar_url: shop?.logo_url
                    },
                    order_items: (itemsBySellerOrderId.get(so.id) || []).map(item => {
                        const product = productMap.get(item.product_id);
                        const variant = item.product_variant_id ? variantMap.get(item.product_variant_id) : null;
                        const variantImage = item.product_variant_id ? variantImageMap.get(item.product_variant_id) : null;
                        const productImage = variantImage || productImageMap.get(item.product_id);
                        
                        const variantLabel = variant ? [
                            variant.size && `Taille: ${variant.size}`,
                            variant.color && `Couleur: ${variant.color}`
                        ].filter(Boolean).join(' • ') : '';
                        
                        return {
                            id: item.id,
                            product_id: item.product_id,
                            product_variant_id: item.product_variant_id,
                            quantity: item.quantity,
                            unit_price: item.unit_price,
                            product: {
                                name: product?.name || 'Produit',
                                image: productImage?.image_url || '',
                                variant_label: variantLabel
                            }
                        };
                    })
                };
            })
        };

        return res.status(200).json({
            message: 'Order retrieved successfully',
            data: result
        });
    } catch (error) {
        console.error('Get order detail error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;