const { supabaseAdmin } = require('../db/supabase');

const BUCKET_NAME = 'sellers_public';
const MARKER_TAG = 'demo-seed-temp';
const STORAGE_URL_MARKER = `/object/public/${BUCKET_NAME}/`;

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

function chunk(array, size) {
    const output = [];

    for (let i = 0; i < array.length; i += size) {
        output.push(array.slice(i, i + size));
    }

    return output;
}

function extractStoragePathFromUrl(imageUrl) {
    if (typeof imageUrl !== 'string') {
        return null;
    }

    const markerIndex = imageUrl.indexOf(STORAGE_URL_MARKER);
    if (markerIndex < 0) {
        return null;
    }

    const encodedPath = imageUrl.slice(markerIndex + STORAGE_URL_MARKER.length);
    if (!encodedPath) {
        return null;
    }

    try {
        return decodeURIComponent(encodedPath);
    } catch {
        return encodedPath;
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (process.env.NODE_ENV === 'production' && !args.allowProd) {
        throw new Error('Refusing to run in production. Use a non-prod environment for demo cleanup.');
    }

    const confirm = Boolean(args.confirm);

    const { data: products, error: productsError } = await supabaseAdmin
        .from('products')
        .select('id, name')
        .contains('tags', [MARKER_TAG]);

    if (productsError) {
        throw new Error(`Unable to fetch seeded products: ${productsError.message}`);
    }

    const productIds = (products || []).map((p) => p.id);

    if (productIds.length === 0) {
        console.log('No seeded demo products found.');
        return;
    }

    const { data: productImages, error: productImagesError } = await supabaseAdmin
        .from('product_images')
        .select('product_id, image_url')
        .in('product_id', productIds);

    if (productImagesError) {
        throw new Error(`Unable to fetch product images: ${productImagesError.message}`);
    }

    const { data: variants, error: variantsError } = await supabaseAdmin
        .from('product_variants')
        .select('id, product_id')
        .in('product_id', productIds);

    if (variantsError) {
        throw new Error(`Unable to fetch product variants: ${variantsError.message}`);
    }

    const variantIds = (variants || []).map((v) => v.id);

    const storagePaths = Array.from(
        new Set(
            (productImages || [])
                .map((img) => extractStoragePathFromUrl(img.image_url))
                .filter(Boolean)
        )
    );

    console.log(`Seeded demo products found: ${productIds.length}`);
    console.log(`Related product images: ${(productImages || []).length}`);
    console.log(`Related variants: ${variantIds.length}`);
    console.log(`Storage objects to remove: ${storagePaths.length}`);

    if (!confirm) {
        console.log('Dry run only. Re-run with --confirm to execute deletion.');
        return;
    }

    if (variantIds.length > 0) {
        const { error: deleteVariantImagesError } = await supabaseAdmin
            .from('product_variant_images')
            .delete()
            .in('product_variant_id', variantIds);

        if (deleteVariantImagesError) {
            throw new Error(`Unable to delete variant images: ${deleteVariantImagesError.message}`);
        }

        const { error: deleteVariantsError } = await supabaseAdmin
            .from('product_variants')
            .delete()
            .in('id', variantIds);

        if (deleteVariantsError) {
            throw new Error(`Unable to delete variants: ${deleteVariantsError.message}`);
        }
    }

    const { error: deleteProductImagesError } = await supabaseAdmin
        .from('product_images')
        .delete()
        .in('product_id', productIds);

    if (deleteProductImagesError) {
        throw new Error(`Unable to delete product images: ${deleteProductImagesError.message}`);
    }

    const { error: deleteProductsError } = await supabaseAdmin
        .from('products')
        .delete()
        .in('id', productIds);

    if (deleteProductsError) {
        throw new Error(`Unable to delete products: ${deleteProductsError.message}`);
    }

    for (const pathsBatch of chunk(storagePaths, 100)) {
        const { error: removeStorageError } = await supabaseAdmin
            .storage
            .from(BUCKET_NAME)
            .remove(pathsBatch);

        if (removeStorageError) {
            throw new Error(`Unable to delete storage objects: ${removeStorageError.message}`);
        }
    }

    console.log('Cleanup complete. Seeded demo products were removed.');
}

main()
    .catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
