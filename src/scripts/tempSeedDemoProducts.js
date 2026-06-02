const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { supabaseAdmin } = require('../db/supabase');

const BUCKET_NAME = 'sellers_public';
const DEFAULT_IMAGE_DIR = path.resolve(__dirname, '../../../products');
const DEFAULT_CATEGORY_ID = 'bc6ef843-abc3-448b-8200-f62755742a09';
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function parseArgs(argv) {
    const args = {};

    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith('--')) {
            continue;
        }

        const key = token.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            args[key] = true;
            continue;
        }

        args[key] = next;
        i += 1;
    }

    return args;
}

const DEMO_PRODUCT_NAMES = [
    'Bouquet Cire Parfumée Rose & Jasmin',
    'Bouquet Wax Melt Vanille Douce',
    'Bouquet Cire Fondue Lavande & Eucalyptus',
    'Bouquet Wax Melt Fleurs d\'Oranger',
    'Bouquet Cire Parfumée Musc Blanc',
    'Bouquet Wax Melt Citron & Menthe',
    'Bouquet Cire Fondue Pivoine & Rose',
    'Bouquet Wax Melt Coco Tropical',
    'Bouquet Cire Parfumée Santal & Bois',
    'Bouquet Wax Melt Hibiscus & Fraise',
    'Bouquet Cire Fondue Cannelle & Épices',
    'Bouquet Wax Melt Magnolia Frais',
    'Bouquet Cire Parfumée Ambre & Vanille',
    'Bouquet Wax Melt Jasmin Étoilé',
    'Bouquet Cire Fondue Ylang & Gardénia',
    'Bouquet Wax Melt Noix de Coco & Lime',
    'Bouquet Cire Parfumée Freesia & Muguet',
    'Bouquet Wax Melt Pomme & Cannelle',
    'Bouquet Cire Fondue Cèdre & Vétiver',
    'Bouquet Wax Melt Lilas Printanier',
    'Bouquet Cire Parfumée Pêche & Miel',
    'Bouquet Wax Melt Caramel & Sucre',
    'Bouquet Cire Fondue Citrus & Basilic',
    'Bouquet Wax Melt Orchidée Sauvage',
    'Bouquet Cire Parfumée Boisé & Ambré',
];

function titleFromFilename(_fileName, index) {
    return DEMO_PRODUCT_NAMES[index % DEMO_PRODUCT_NAMES.length];
}

async function findImageFiles(imageDir) {
    const entries = await fs.readdir(imageDir, { withFileTypes: true });

    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => SUPPORTED_EXTENSIONS.has(path.extname(name).toLowerCase()))
        .sort((a, b) => a.localeCompare(b));
}

async function resolveShopId(shopIdArg) {
    if (shopIdArg) {
        return shopIdArg;
    }

    const { data: shops, error: shopsError } = await supabaseAdmin
        .from('shops')
        .select('id, is_live, seller_id')
        .eq('is_live', true)
        .order('created_at', { ascending: true });

    if (shopsError) {
        throw new Error(`Unable to fetch shops: ${shopsError.message}`);
    }

    const liveShops = (shops || []).filter((shop) => shop.id && shop.seller_id);

    if (liveShops.length === 0) {
        throw new Error('No live shop found. Provide --shopId <uuid>.');
    }

    const sellerIds = Array.from(new Set(liveShops.map((shop) => shop.seller_id)));

    const { data: kycDocs, error: kycError } = await supabaseAdmin
        .from('kyc_documents')
        .select('seller_id, status')
        .in('seller_id', sellerIds)
        .eq('status', 'approved');

    if (kycError) {
        throw new Error(`Unable to fetch approved KYC documents: ${kycError.message}`);
    }

    const approvedSellerIds = new Set((kycDocs || []).map((doc) => doc.seller_id));
    const eligibleShop = liveShops.find((shop) => approvedSellerIds.has(shop.seller_id));

    if (!eligibleShop?.id) {
        throw new Error('No live shop with approved KYC found. Provide --shopId <uuid>.');
    }

    return eligibleShop.id;
}

async function resolveCategoryId(categoryIdArg) {
    if (categoryIdArg) {
        return categoryIdArg;
    }

    if (DEFAULT_CATEGORY_ID) {
        return DEFAULT_CATEGORY_ID;
    }

    const { data, error } = await supabaseAdmin
        .from('categories')
        .select('id')
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new Error(`Unable to fetch a category: ${error.message}`);
    }

    if (!data?.id) {
        throw new Error('No category found. Provide --categoryId <uuid>.');
    }

    return data.id;
}

async function uploadMainImage({ shopId, productId, sourcePath }) {
    const sourceBuffer = await fs.readFile(sourcePath);

    const webpBuffer = await sharp(sourceBuffer)
        .rotate()
        .resize({ width: 1200, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

    const storagePath = `products/${shopId}/${productId}/${crypto.randomUUID()}.webp`;

    const { error: uploadError } = await supabaseAdmin
        .storage
        .from(BUCKET_NAME)
        .upload(storagePath, webpBuffer, {
            contentType: 'image/webp',
            cacheControl: '3600',
            upsert: false,
        });

    if (uploadError) {
        throw new Error(`Image upload failed: ${uploadError.message}`);
    }

    const { data: publicData } = supabaseAdmin
        .storage
        .from(BUCKET_NAME)
        .getPublicUrl(storagePath);

    return publicData.publicUrl;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (process.env.NODE_ENV === 'production' && !args.allowProd) {
        throw new Error('Refusing to run in production. Use a non-prod environment for demo seeding.');
    }

    const imageDir = args.imageDir ? path.resolve(process.cwd(), args.imageDir) : DEFAULT_IMAGE_DIR;
    const limit = Number.isFinite(Number(args.limit)) ? Math.max(1, Number(args.limit)) : 24;
    const shopId = await resolveShopId(args.shopId);
    const categoryId = await resolveCategoryId(args.categoryId);

    const imageFiles = await findImageFiles(imageDir);

    if (imageFiles.length === 0) {
        throw new Error(`No supported image files found in ${imageDir}`);
    }

    const targetFiles = imageFiles.slice(0, limit);

    console.log(`Using image directory: ${imageDir}`);
    console.log(`Shop: ${shopId}`);
    console.log(`Category: ${categoryId}`);
    console.log(`Creating up to ${targetFiles.length} demo products...`);

    let createdCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < targetFiles.length; i += 1) {
        const fileName = targetFiles[i];
        const sourcePath = path.join(imageDir, fileName);

        const productName = titleFromFilename(fileName, i);
        const price = 500 + (i % 12) * 125;
        const stock = 3 + (i % 10);

        let productId;

        try {
            // Validate and normalize image before creating DB rows.
            await sharp(await fs.readFile(sourcePath)).rotate().metadata();

            const { data: insertedProduct, error: insertProductError } = await supabaseAdmin
                .from('products')
                .insert([{
                    shop_id: shopId,
                    category_id: categoryId,
                    name: productName,
                    description: `Produit de demonstration cree automatiquement depuis ${fileName}.`,
                    tags: ['demo', 'seed', 'demo-seed-temp'],
                    price,
                    stock,
                    status: 'published',
                    has_variants: false,
                    low_stock_threshold: 2,
                }])
                .select('id')
                .single();

            if (insertProductError) {
                throw new Error(`Product insert failed: ${insertProductError.message}`);
            }

            productId = insertedProduct.id;

            const publicUrl = await uploadMainImage({
                shopId,
                productId,
                sourcePath,
            });

            const { error: insertImageError } = await supabaseAdmin
                .from('product_images')
                .insert([{
                    product_id: productId,
                    image_url: publicUrl,
                    position: 0,
                    is_main: true,
                }]);

            if (insertImageError) {
                throw new Error(`Image row insert failed: ${insertImageError.message}`);
            }

            createdCount += 1;
            console.log(`[OK] ${productName}`);
        } catch (error) {
            skippedCount += 1;
            console.warn(`[SKIP] ${fileName} -> ${error.message}`);

            if (productId) {
                await supabaseAdmin
                    .from('products')
                    .delete()
                    .eq('id', productId);
            }
        }
    }

    console.log('---');
    console.log(`Done. Created: ${createdCount}, Skipped: ${skippedCount}`);
}

main()
    .catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
