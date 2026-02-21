const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const authenticateUser = require('../../../middlewares/authMiddleware');
const { supabase } = require('../../../db/supabase');
const { sellerStoreLimiter } = require('../../../middlewares/limit');
const upload = require('../../../middlewares/uploadMiddleware');
const sharp = require('sharp');
const { cp } = require('fs');

const BUCKET_NAME = 'sellers_public';
const MAX_IMAGES = 3;
const IMAGE_WIDTH = 1200;
const IMAGE_QUALITY = 80;

// POST /sellers/shop/products
router.post('/add-product', 
    authenticateUser, 
    sellerStoreLimiter,
    upload.array('images', MAX_IMAGES),
    async (req, res) => {
        try {
            const user = req.user;
            const { 
                name, 
                description, 
                category_id, 
                tags, 
                price, 
                stock, 
                low_stock_threshold, 
                status 
            } = req.body;

            // Validate required fields
            if (!name?.trim() || !description?.trim() || !category_id?.trim()) {
                return res.status(400).json({ message: 'Name, description, and category_id are required' });
            }

            // Validate numeric fields
            const numericPrice = parseFloat(price);
            const numericStock = parseInt(stock);
            
            if (isNaN(numericPrice) || numericPrice < 0) {
                return res.status(400).json({ message: 'Invalid price value' });
            }
            
            if (isNaN(numericStock) || numericStock < 0) {
                return res.status(400).json({ message: 'Invalid stock value' });
            }

            // Validate status
            const validStatuses = ['draft', 'published'];
            const productStatus = status && validStatuses.includes(status) ? status : 'draft';

            // Validate images
            const files = req.files || [];
            if (files.length === 0) {
                return res.status(400).json({ message: 'At least one product image is required' });
            }
            if (files.length > MAX_IMAGES) {
                return res.status(400).json({ message: `Maximum ${MAX_IMAGES} images allowed` });
            }

            // Ensure seller exists in sellers table 
            const { data: sellerRow, error: sellerFetchError } = await supabase
                .from('sellers')
                .select('id')
                .eq('user_id', user.id)
                .maybeSingle();

            if (sellerFetchError) {
                console.error('Error checking seller:', sellerFetchError);
                return res.status(500).json({ message: 'Error verifying seller record' });
            }
            
            if (!sellerRow) {
                return res.status(404).json({ message: 'Seller record not found' });
            }

            // Fetch existing shop
            const { data: shopRow, error: shopFetchError } = await supabase
                .from('shops')
                .select('id')
                .eq('seller_id', sellerRow.id)
                .maybeSingle();

            if (shopFetchError) {
                console.error('Error fetching shop:', shopFetchError);
                return res.status(500).json({ message: 'Error fetching shop record' });
            }

            if (!shopRow) {
                return res.status(404).json({ message: 'Shop not found for this seller' });
            }

            // Validate that the category exists
            const { data: categoryRow, error: categoryFetchError } = await supabase
                .from('categories')
                .select('id, name, parent_id')
                .eq('id', category_id.trim())
                .maybeSingle();

            if (categoryFetchError) {
                console.error('Error fetching category:', categoryFetchError);
                return res.status(500).json({ message: 'Error verifying product category' });
            }

            if (!categoryRow) {
                return res.status(400).json({ message: 'Invalid category_id: category not found' });
            }

            // Insert product record
            const hasVariantsFlag = !!req.body.variants;
            const { data: productData, error: productInsertError } = await supabase
                .from('products')
                .insert([{
                    shop_id: shopRow.id,
                    name: name.trim(),
                    description: description.trim(),
                    category_id: category_id.trim(),
                    tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
                    price: numericPrice,
                    stock: numericStock,
                    low_stock_threshold: low_stock_threshold ? parseInt(low_stock_threshold) : null,
                    status: productStatus,
                    has_variants: hasVariantsFlag
                }])
                .select()
                .single();

            if (productInsertError) {
                console.error('Error inserting product:', productInsertError);
                return res.status(500).json({ message: 'Error adding product' });
            }

            const productId = productData.id;

            // Parse variants early so we can map uploaded files to variant images
            const variantsRaw = req.body.variants;
            let variantsList = [];
            if (variantsRaw) {
                if (typeof variantsRaw === 'string') {
                    try {
                        variantsList = JSON.parse(variantsRaw);
                    } catch (e) {
                        variantsList = [];
                    }
                } else if (Array.isArray(variantsRaw)) {
                    variantsList = variantsRaw;
                }
            }

            // Build mapping: fileIndex -> { variantIndex, position }
            const fileToVariantMap = new Map();
            variantsList.forEach((v, vi) => {
                if (v.images && Array.isArray(v.images)) {
                    v.images.forEach((fileIdx, pos) => {
                        if (Number.isInteger(fileIdx) && fileIdx >= 0 && fileIdx < files.length) {
                            if (!fileToVariantMap.has(fileIdx)) fileToVariantMap.set(fileIdx, []);
                            fileToVariantMap.get(fileIdx).push({ variantIndex: vi, position: pos });
                        }
                    });
                }
            });

            // Upload images, convert them to webp using sharp and keep mapping by file index
            const uploadedFiles = new Array(files.length);
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                try {
                    const webpBuffer = await sharp(file.buffer)
                        .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
                        .webp({ quality: IMAGE_QUALITY })
                        .toBuffer();
                    const uniqueId = crypto.randomUUID();
                    // If this file is tied to a variant, store under variants path; otherwise product path
                    const isVariantFile = fileToVariantMap.has(i);
                    const filePath = isVariantFile
                        ? `products/${shopRow.id}/${productId}/variants/${uniqueId}.webp`
                        : `products/${shopRow.id}/${productId}/${uniqueId}.webp`;

                    const { error: uploadError } = await supabase
                        .storage
                        .from(BUCKET_NAME)
                        .upload(filePath, webpBuffer, {
                            cacheControl: '3600',
                            upsert: false,
                            contentType: 'image/webp'
                        });

                    if (uploadError) {
                        console.error('Error uploading image:', uploadError);
                        return res.status(500).json({ message: 'Error uploading product images' });
                    }

                    const { data: { publicUrl } } = supabase
                        .storage
                        .from(BUCKET_NAME)
                        .getPublicUrl(filePath);

                    uploadedFiles[i] = { url: publicUrl };
                } catch (imageError) {
                    console.error('Error processing image:', imageError);
                    return res.status(500).json({ message: 'Error processing product images' });
                }
            }

            // Insert product-level images (files not referenced by any variant)
            const productImageRecords = [];
            for (let i = 0; i < uploadedFiles.length; i++) {
                if (!fileToVariantMap.has(i)) {
                    productImageRecords.push({
                        product_id: productId,
                        image_url: uploadedFiles[i].url,
                        position: productImageRecords.length,
                        is_main: productImageRecords.length === 0
                    });
                }
            }

            if (productImageRecords.length > 0) {
                const { error: imageInsertError } = await supabase
                    .from('product_images')
                    .insert(productImageRecords);

                if (imageInsertError) {
                    console.error('Error inserting product image records:', imageInsertError);
                    return res.status(500).json({ message: 'Error saving product images' });
                }
            }

            // Insert variants (if provided) into `product_variants` table and get inserted rows
            let insertedVariants = [];
            try {
                if (variantsList.length > 0) {
                    const variantRecords = variantsList.map((v, idx) => ({
                        product_id: productId,
                        sku: v.sku || `${productId}-${idx + 1}`,
                        size: v.size || null,
                        size_value: v.size && !Number.isNaN(Number(v.size)) ? Number(v.size) : (v.size_value || null),
                        color: v.color || null,
                        attributes: v.attributes || null,
                        price: (v.price !== undefined && v.price !== null) ? v.price : null,
                        stock: (v.stock !== undefined && v.stock !== null) ? v.stock : null,
                        is_limited_stock: v.is_limited_stock || false,
                        low_stock_threshold: v.low_stock_threshold || null
                    }));

                    const { data: variantsInsertData, error: variantsInsertError } = await supabase
                        .from('product_variants')
                        .insert(variantRecords)
                        .select();

                    if (variantsInsertError) {
                        console.error('Error inserting product variants:', variantsInsertError);
                        return res.status(500).json({ message: 'Product created but failed to save variants' });
                    }

                    insertedVariants = variantsInsertData || [];
                }
            } catch (variantErr) {
                console.error('Error processing variants:', variantErr);
                return res.status(500).json({ message: 'Product created but variant processing failed' });
            }

            // Insert variant images mapping uploaded files to created variant IDs
            const variantImageRecords = [];
            for (const [fileIdx, mappings] of fileToVariantMap.entries()) {
                const uploaded = uploadedFiles[fileIdx];
                if (!uploaded) continue;
                for (const mapEntry of mappings) {
                    const vIdx = mapEntry.variantIndex;
                    const pos = mapEntry.position || 0;
                    const variantRow = insertedVariants[vIdx];
                    if (!variantRow) continue; // no matching inserted variant
                    variantImageRecords.push({
                        product_variant_id: variantRow.id,
                        image_url: uploaded.url,
                        position: pos,
                        is_main: pos === 0
                    });
                }
            }

            if (variantImageRecords.length > 0) {
                const { error: variantImagesInsertError } = await supabase
                    .from('product_variant_images')
                    .insert(variantImageRecords);

                if (variantImagesInsertError) {
                    console.error('Error inserting variant images:', variantImagesInsertError);
                    return res.status(500).json({ message: 'Product created but failed to save variant images' });
                }
            }

            return res.status(201).json({ 
                message: 'Product added successfully', 
                product: productData 
            });
        } catch (error) {
            console.error('Error adding product:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    });

    
// GET /sellers/shop/products GLOBAL - fetch products with filters
router.get('/get-products', sellerStoreLimiter, async (req, res) => {
    const { productId, shopId, category_id, parent_category_id, commune_id, search, limit = 20, offset = 0 } = req.query;

    try {
        const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
        const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

        let query = supabase.from('products').select(
            `*,
            shop:shops(id, name, logo_url, description, created_at, is_live, locations:shop_locations(commune_id), seller:sellers(kyc_documents(status))),
            images:product_images(image_url, position, is_main),
            variants:product_variants(
                id, sku, size, size_value, color, attributes, price, stock, is_limited_stock, low_stock_threshold,
                images:product_variant_images(image_url, position, is_main)
            ),
            category:categories(id, name, parent_id, parent:categories!parent_id(id, name))
            `
        );

        if (productId) query = query.eq('id', productId);
        if (shopId) query = query.eq('shop_id', shopId); 
        if (category_id) query = query.eq('category_id', category_id);
        
        query = query.eq('status', 'published');

        if (commune_id) {
            const { data: locationRows, error: locationError } = await supabase
                .from('shop_locations')
                .select('shop_id')
                .eq('commune_id', commune_id);

            if (locationError) throw locationError;

            const shopIds = (locationRows || []).map((row) => row.shop_id).filter(Boolean);
            if (shopIds.length === 0) {
                return res.json({ products: [] });
            }

            query = query.in('shop_id', shopIds);
        }
        
        // Filter by parent category (will include all products in subcategories of this parent)
        if (parent_category_id) {
            const { data: subcategories } = await supabase
                .from('categories')
                .select('id')
                .or(`id.eq.${parent_category_id},parent_id.eq.${parent_category_id}`);
            
            if (subcategories && subcategories.length > 0) {
                const categoryIds = subcategories.map(cat => cat.id);
                query = query.in('category_id', categoryIds);
            }
        }
        if (search) {
            const searchTerm = String(search).trim();
            if (searchTerm.length > 0) {
                const likeTerm = `%${searchTerm}%`;
                query = query.or(`name.ilike.${likeTerm},description.ilike.${likeTerm}`);

                const searchTags = searchTerm
                    .split(',')
                    .map(tag => tag.trim())
                    .filter(Boolean);

                if (searchTags.length > 0) {
                    query = query.contains('tags', searchTags);
                }
            }
        }

        const { data, error } = await query.range(parsedOffset, parsedOffset + parsedLimit - 1);

        if (error) throw error;

        // Filter to only show products from sellers with approved KYC documents and shops that are live
        const filteredProducts = data?.filter(product => {
            // Check if shop is live
            if (!product.shop?.is_live) {
                return false; // Exclude products from offline shops
            }

            // Check for approved KYC documents
            if (product.shop?.seller?.kyc_documents) {
                const hasApprovedKYC = product.shop.seller.kyc_documents.some(
                    doc => doc.status === 'approved'
                );
                return hasApprovedKYC;
            }
            return false; // Exclude products without seller/kyc_documents info
        }).map(product => {
            // Keep only approved kyc_documents in the response
            const approvedDocs = product.shop.seller.kyc_documents.filter(
                doc => doc.status === 'approved'
            );
            return {
                ...product,
                shop: {
                    ...product.shop,
                    seller: {
                        ...product.shop.seller,
                        kyc_documents: approvedDocs
                    }
                }
            };
        });

        return res.json({ products: filteredProducts || [] });
    } catch (error) {
        console.error('Error fetching products:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
})


// GET /sellers/shop/products - fetch products for authenticated seller
router.get('/get-seller-products', sellerStoreLimiter, authenticateUser, async (req, res) => {
    const { productId, category_id, parent_category_id, status, search, limit = 20, offset = 0 } = req.query;
    const user = req.user;
    
    try {
        // Find seller by user_id
        const { data: sellerRow, error: sellerFetchError } = await supabase
            .from('sellers')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (sellerFetchError) {
            console.error('Error fetching seller:', sellerFetchError);
            return res.status(500).json({ message: 'Error verifying seller record' });
        }

        if (!sellerRow) {
            return res.status(404).json({ message: 'Seller record not found' });
        }

        // Get the shop_id using seller.id
        const { data: shopData, error: shopError } = await supabase
            .from('shops')
            .select('id')
            .eq('seller_id', sellerRow.id)
            .maybeSingle();

        if (shopError) {
            console.error('Error fetching shop:', shopError);
            return res.status(500).json({ message: 'Error fetching shop record' });
        }

        if (!shopData) {
            return res.status(404).json({ message: 'Shop not found for this seller' });
        }

        // Parse pagination parameters
        const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
        const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

        // Build query for this seller's shop only
        let query = supabase.from('products').select(
            `*,
            shop:shops(id, name, logo_url),
            images:product_images(image_url, position, is_main),
            variants:product_variants(
                id, sku, size, size_value, color, attributes, price, stock, is_limited_stock, low_stock_threshold,
                images:product_variant_images(image_url, position, is_main)
            ),
            category:categories(id, name, parent_id, parent:categories!parent_id(id, name))
            `
        ).eq('shop_id', shopData.id);

        if (productId) query = query.eq('id', productId);
        if (category_id) query = query.eq('category_id', category_id);
        if (status) query = query.eq('status', status);
        
        // Filter by parent category (will include all products in subcategories of this parent)
        if (parent_category_id) {
            const { data: subcategories } = await supabase
                .from('categories')
                .select('id')
                .or(`id.eq.${parent_category_id},parent_id.eq.${parent_category_id}`);
            
            if (subcategories && subcategories.length > 0) {
                const categoryIds = subcategories.map(cat => cat.id);
                query = query.in('category_id', categoryIds);
            }
        }
        if (search) {
            const searchTerm = String(search).trim();
            if (searchTerm.length > 0) {
                const likeTerm = `%${searchTerm}%`;
                query = query.or(`name.ilike.${likeTerm},description.ilike.${likeTerm}`);

                const searchTags = searchTerm
                    .split(',')
                    .map(tag => tag.trim())
                    .filter(Boolean);

                if (searchTags.length > 0) {
                    query = query.contains('tags', searchTags);
                }
            }
        }

        const { data, error } = await query.range(parsedOffset, parsedOffset + parsedLimit - 1);

        if (error) throw error;

        return res.json({ products: data });
    } catch (error) {
        console.error('Error fetching seller products:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// PATCH /sellers/shop/products/:id
router.patch('/update-seller-products/:id', 
    authenticateUser, 
    sellerStoreLimiter,
    upload.array('images', MAX_IMAGES),
    async (req, res) => {
        try {
            const user = req.user;
            const productId = req.params.id;
            const { 
                name, 
                description, 
                category_id, 
                tags, 
                price, 
                stock, 
                low_stock_threshold, 
                status,
                existing_images,
                variants,
                deleted_variant_ids
            } = req.body;

            // Verify seller owns this product
            const { data: sellerRow, error: sellerFetchError } = await supabase
                .from('sellers')
                .select('id')
                .eq('user_id', user.id)
                .maybeSingle();

            if (sellerFetchError || !sellerRow) {
                return res.status(401).json({ message: 'Unauthorized' });
            }

            // Fetch product and verify ownership
            const { data: productData, error: productFetchError } = await supabase
                .from('products')
                .select('*, shop:shops(id, seller_id)')
                .eq('id', productId)
                .maybeSingle();

            if (productFetchError || !productData) {
                return res.status(404).json({ message: 'Product not found' });
            }

            if (productData.shop.seller_id !== sellerRow.id) {
                return res.status(403).json({ message: 'Forbidden: You do not own this product' });
            }

            const shopId = productData.shop.id;

            // Validate and prepare update payload
            const updatePayload = {};

            if (name !== undefined) {
                if (!name?.trim()) {
                    return res.status(400).json({ message: 'Name cannot be empty' });
                }
                updatePayload.name = name.trim();
            }

            if (description !== undefined) {
                if (!description?.trim()) {
                    return res.status(400).json({ message: 'Description cannot be empty' });
                }
                updatePayload.description = description.trim();
            }

            if (category_id !== undefined) {
                if (!category_id?.trim()) {
                    return res.status(400).json({ message: 'Category is required' });
                }
                // Validate category exists
                const { data: categoryData } = await supabase
                    .from('categories')
                    .select('id')
                    .eq('id', category_id.trim())
                    .maybeSingle();

                if (!categoryData) {
                    return res.status(400).json({ message: 'Invalid category_id' });
                }
                updatePayload.category_id = category_id.trim();
            }

            if (price !== undefined) {
                const numericPrice = parseFloat(price);
                if (isNaN(numericPrice) || numericPrice < 0) {
                    return res.status(400).json({ message: 'Invalid price value' });
                }
                updatePayload.price = numericPrice;
            }

            if (stock !== undefined) {
                const numericStock = parseInt(stock);
                if (isNaN(numericStock) || numericStock < 0) {
                    return res.status(400).json({ message: 'Invalid stock value' });
                }
                updatePayload.stock = numericStock;
            }

            if (low_stock_threshold !== undefined) {
                if (low_stock_threshold === null || low_stock_threshold === '') {
                    updatePayload.low_stock_threshold = null;
                } else {
                    const threshold = parseInt(low_stock_threshold);
                    if (isNaN(threshold) || threshold < 0) {
                        return res.status(400).json({ message: 'Invalid low_stock_threshold value' });
                    }
                    updatePayload.low_stock_threshold = threshold;
                }
            }

            if (status !== undefined) {
                const validStatuses = ['draft', 'published'];
                if (!validStatuses.includes(status)) {
                    return res.status(400).json({ message: 'Invalid status' });
                }
                updatePayload.status = status;
            }

            if (tags !== undefined) {
                updatePayload.tags = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
            }

            // Update product record if there are changes
            if (Object.keys(updatePayload).length > 0) {
                const { error: productUpdateError } = await supabase
                    .from('products')
                    .update(updatePayload)
                    .eq('id', productId);

                if (productUpdateError) {
                    console.error('Error updating product:', productUpdateError);
                    return res.status(500).json({ message: 'Error updating product' });
                }
            }

            // Handle image management
            const files = req.files || [];
            const existingImageIds = existing_images ? JSON.parse(typeof existing_images === 'string' ? existing_images : JSON.stringify(existing_images)) : [];

            // Delete product images not in the existing_images list
            if (existingImageIds.length > 0 || files.length === 0) {
                const { data: allProductImages } = await supabase
                    .from('product_images')
                    .select('id, image_url')
                    .eq('product_id', productId);

                if (allProductImages) {
                    const imagesToDelete = allProductImages.filter(img => !existingImageIds.includes(img.id));
                    for (const img of imagesToDelete) {
                        // Extract storage path from URL and delete
                        const urlParts = img.image_url.split('/');
                        if (urlParts.length >= 2) {
                            const storagePath = urlParts.slice(-4).join('/');
                            await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
                        }
                    }

                    if (imagesToDelete.length > 0) {
                        const deleteIds = imagesToDelete.map(img => img.id);
                        await supabase
                            .from('product_images')
                            .delete()
                            .in('id', deleteIds);
                    }
                }
            }

            // Upload new images if provided
            const uploadedNewFiles = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                try {
                    const webpBuffer = await sharp(file.buffer)
                        .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
                        .webp({ quality: IMAGE_QUALITY })
                        .toBuffer();
                    const uniqueId = crypto.randomUUID();
                    const filePath = `products/${shopId}/${productId}/${uniqueId}.webp`;

                    const { error: uploadError } = await supabase
                        .storage
                        .from(BUCKET_NAME)
                        .upload(filePath, webpBuffer, {
                            cacheControl: '3600',
                            upsert: false,
                            contentType: 'image/webp'
                        });

                    if (uploadError) {
                        console.error('Error uploading image:', uploadError);
                        return res.status(500).json({ message: 'Error uploading product images' });
                    }

                    const { data: { publicUrl } } = supabase
                        .storage
                        .from(BUCKET_NAME)
                        .getPublicUrl(filePath);

                    uploadedNewFiles.push({ url: publicUrl });
                } catch (imageError) {
                    console.error('Error processing image:', imageError);
                    return res.status(500).json({ message: 'Error processing product images' });
                }
            }

            // Insert new product images
            if (uploadedNewFiles.length > 0) {
                const newImageRecords = uploadedNewFiles.map((file, idx) => ({
                    product_id: productId,
                    image_url: file.url,
                    position: existingImageIds.length + idx,
                    is_main: existingImageIds.length === 0 && idx === 0
                }));

                const { error: imageInsertError } = await supabase
                    .from('product_images')
                    .insert(newImageRecords);

                if (imageInsertError) {
                    console.error('Error inserting new images:', imageInsertError);
                    return res.status(500).json({ message: 'Error saving new product images' });
                }
            }

            // Handle variant management
            const variantsRaw = variants;
            let variantsList = [];
            if (variantsRaw) {
                if (typeof variantsRaw === 'string') {
                    try {
                        variantsList = JSON.parse(variantsRaw);
                    } catch (e) {
                        variantsList = [];
                    }
                } else if (Array.isArray(variantsRaw)) {
                    variantsList = variantsRaw;
                }
            }

            // Delete marked variants
            const deletedIds = deleted_variant_ids ? JSON.parse(typeof deleted_variant_ids === 'string' ? deleted_variant_ids : JSON.stringify(deleted_variant_ids)) : [];
            if (deletedIds.length > 0) {
                // Get variant images to delete from storage
                const { data: variantImagesToDelete } = await supabase
                    .from('product_variant_images')
                    .select('id, image_url')
                    .in('product_variant_id', deletedIds);

                if (variantImagesToDelete && variantImagesToDelete.length > 0) {
                    for (const img of variantImagesToDelete) {
                        const urlParts = img.image_url.split('/');
                        if (urlParts.length >= 2) {
                            const storagePath = urlParts.slice(-4).join('/');
                            await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
                        }
                    }

                    const imgIds = variantImagesToDelete.map(img => img.id);
                    await supabase
                        .from('product_variant_images')
                        .delete()
                        .in('id', imgIds);
                }

                // Delete variants
                await supabase
                    .from('product_variants')
                    .delete()
                    .in('id', deletedIds);
            }

            // Process new and existing variants
            const newVariants = variantsList.filter(v => !v.id);
            const existingVariants = variantsList.filter(v => v.id);

            // Insert new variants
            let insertedVariants = [];
            if (newVariants.length > 0) {
                const variantRecords = newVariants.map((v, idx) => ({
                    product_id: productId,
                    sku: v.sku || `${productId}-${idx + 1}`,
                    size: v.size || null,
                    size_value: v.size_value || null,
                    color: v.color || null,
                    attributes: v.attributes || null,
                    price: (v.price !== undefined && v.price !== null) ? v.price : null,
                    stock: (v.stock !== undefined && v.stock !== null) ? v.stock : null,
                    is_limited_stock: v.is_limited_stock || false,
                    low_stock_threshold: v.low_stock_threshold || null
                }));

                const { data: variantsInsertData, error: variantsInsertError } = await supabase
                    .from('product_variants')
                    .insert(variantRecords)
                    .select();

                if (variantsInsertError) {
                    console.error('Error inserting new variants:', variantsInsertError);
                    return res.status(500).json({ message: 'Error adding new variants' });
                }

                insertedVariants = variantsInsertData || [];
            }

            // Update existing variants
            for (const variant of existingVariants) {
                const variantUpdatePayload = {
                    sku: variant.sku || `${productId}-${variant.id}`,
                    size: variant.size || null,
                    size_value: variant.size_value || null,
                    color: variant.color || null,
                    attributes: variant.attributes || null,
                    price: (variant.price !== undefined && variant.price !== null) ? variant.price : null,
                    stock: (variant.stock !== undefined && variant.stock !== null) ? variant.stock : null,
                    is_limited_stock: variant.is_limited_stock || false,
                    low_stock_threshold: variant.low_stock_threshold || null
                };

                const { error: updateError } = await supabase
                    .from('product_variants')
                    .update(variantUpdatePayload)
                    .eq('id', variant.id)
                    .eq('product_id', productId);

                if (updateError) {
                    console.error('Error updating variant:', updateError);
                    return res.status(500).json({ message: 'Error updating variant' });
                }
            }

            // Fetch updated product with all relations
            const { data: updatedProduct, error: fetchError } = await supabase
                .from('products')
                .select(
                    `*,
                    shop:shops(id, name, logo_url),
                    images:product_images(id, image_url, position, is_main),
                    variants:product_variants(
                        id, sku, size, size_value, color, attributes, price, stock, is_limited_stock, low_stock_threshold,
                        images:product_variant_images(image_url, position, is_main)
                    ),
                    category:categories(id, name, parent_id, parent:categories!parent_id(id, name))
                    `
                )
                .eq('id', productId)
                .maybeSingle();

            if (fetchError || !updatedProduct) {
                console.error('Error fetching updated product:', fetchError);
                return res.status(500).json({ message: 'Product updated but failed to fetch updated data' });
            }

            return res.json({ 
                message: 'Product updated successfully', 
                product: updatedProduct 
            });
        } catch (error) {
            console.error('Error updating product:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    }
);


// DELETE /sellers/shop/products
// TODO: DELETE PRODUCT - complete the implementation later
router.delete('/delete-seller-products/:id', authenticateUser, sellerStoreLimiter, async (req, res) => {
    try {
        const user = req.user;
        const productId = req.params.id;

        // Verify seller owns this product
        const { data: sellerRow, error: sellerFetchError } = await supabase
            .from('sellers')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();
        if (sellerFetchError || !sellerRow) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Fetch product and verify ownership
        const { data: productData, error: productFetchError } = await supabase
            .from('products')
            .select('*, shop:shops(id, seller_id)')
            .eq('id', productId)
            .maybeSingle();
        
            if (productFetchError || !productData) {
            return res.status(404).json({ message: 'Product not found' });
        }

        if (productData.shop.seller_id !== sellerRow.id) {
            return res.status(403).json({ message: 'Forbidden: You do not own this product' });
        }

        // Check if product has any orders
        const { data: orderItems, error: orderCheckError } = await supabase
            .from('order_items')
            .select('id')
            .eq('product_id', productId)
            .limit(1);

        if (orderCheckError) {
            console.error('Error checking orders:', orderCheckError);
            return res.status(500).json({ message: 'Error checking product orders' });
        }

        if (orderItems && orderItems.length > 0) {
            return res.status(400).json({ 
                message: 'Cannot delete product with existing orders. Consider marking it as draft instead.',
                hasOrders: true,
                canDeactivate: true
            });
        }

        // get and delete variant images
        const { data: variantImages } = await supabase
            .from('product_variant_images')
            .select('id, image_url, variant:product_variants!inner(product_id)')
            .eq('product_id', productId);

            if (variantImages && variantImages.length > 0) {
                for (const img of variantImages) {
                    const urlParts = img.image_url.split('/');
                    if (urlParts.length >= 2) {
                        const filePath = urlParts.slice(-4).join('/');
                        await supabase.storage.from(BUCKET_NAME).remove([filePath]);
                    }
                }

                const imgIds = variantImages.map(img => img.id);
                await supabase
                    .from('product_variant_images')
                    .delete()
                    .in('id', imgIds);
            }

            // delete variants
            await supabase.from('product_variants').delete().eq('product_id', productId);

            // get and delete product images
            const { data: productImages } = await supabase
                .from('product_images')
                .select('id, image_url')
                .eq('product_id', productId);

            if (productImages && productImages.length > 0) {
                for (const img of productImages) {
                    const urlParts = img.image_url.split('/');
                    if (urlParts.length >= 2) {
                        const filePath = urlParts.slice(-4).join('/');
                        await supabase.storage.from(BUCKET_NAME).remove([filePath]);
                    }
                }

                const imgIds = productImages.map(img => img.id);
                await supabase
                    .from('product_images')
                    .delete()
                    .in('id', imgIds);
            }

            // delete product
            const { error: productDeleteError } = await supabase
                .from('products')
                .delete()
                .eq('id', productId);

            if (productDeleteError) {
                console.error('Error deleting product:', productDeleteError);
                return res.status(500).json({ message: 'Error deleting product' });
            }

            return res.json({ message: 'Product deleted successfully' });
    } catch (error) {
        console.error('Error deleting product:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
})


// Fetch product categories
router.get('/categories', sellerStoreLimiter, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('categories')
            .select('*')
            .order('name', { ascending: true });
        if (error) {
            console.error('Error fetching categories:', error);
            return res.status(500).json({ message: 'Error fetching product categories' });
        }
        return res.json({ categories: data });
    } catch (error) {
        
    }
})
module.exports = router;