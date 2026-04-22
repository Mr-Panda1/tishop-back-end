const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { supabaseAdmin } = require('../db/supabase');

const BUCKET_NAME = 'sellers_public';
const DEFAULT_IMAGE_DIR = path.resolve(__dirname, '../../../products');
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

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

function titleFromFilename(fileName) {
    const noExt = fileName.replace(path.extname(fileName), '');
    const cleaned = noExt
        .replace(/[_~]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) {
        return 'Produit Demo';
    }

    return cleaned.slice(0, 80);
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

    const { data, error } = await supabaseAdmin
        .from('shops')
        .select('id')
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new Error(`Unable to fetch a shop: ${error.message}`);
    }

    if (!data?.id) {
        throw new Error('No shop found. Provide --shopId <uuid>.');
    }

    return data.id;
}

async function resolveCategoryId(categoryIdArg) {
    if (categoryIdArg) {
        return categoryIdArg;
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

        const baseTitle = titleFromFilename(fileName);
        const productName = `${baseTitle} (Demo ${i + 1})`;
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
