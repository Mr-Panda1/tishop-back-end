const express = require('express')
const { supabase, supabaseAdmin } = require('../../../db/supabase');
const router = express.Router();
const { authLimiter } = require('../../../middlewares/limit');
const authenticateUser = require('../../../middlewares/authMiddleware');

const ONBOARDING_EVENT_TYPES = new Set(['step_viewed', 'step_completed', 'cta_clicked']);

const ONBOARDING_STEPS = {
    brand: {
        key: 'brand',
        title: 'Personnaliser votre marque',
        description: 'Nom, logo, description et identité de boutique.',
        cta_path: '/seller/store',
        cta_label: 'Configurer la marque',
        auto: true,
    },
    first_product: {
        key: 'first_product',
        title: 'Ajouter votre premier produit',
        description: 'Photos, prix, description et stock.',
        cta_path: '/seller/products',
        cta_label: 'Ajouter un produit',
        auto: true,
    },
    payment_method: {
        key: 'payment_method',
        title: 'Configurer un mode de paiement',
        description: 'Connectez votre compte MonCash ou NatCash.',
        cta_path: '/seller/settings?tab=payment',
        cta_label: 'Configurer les paiements',
        auto: true,
    },
    kyc_approved: {
        key: 'kyc_approved',
        title: 'Valider votre KYC',
        description: 'Soumettez vos documents et attendez l approbation KYC.',
        cta_path: '/seller/finances',
        cta_label: 'Completer le KYC',
        auto: true,
    },
    delivery_zone: {
        key: 'delivery_zone',
        title: 'Definir une zone de livraison',
        description: 'Indiquez ou vous livrez et vos frais.',
        cta_path: '/seller/store',
        cta_label: 'Configurer la livraison',
        auto: true,
    },
    policies: {
        key: 'policies',
        title: 'Definir vos regles de boutique',
        description: 'Annulations, livraison et contact client.',
        cta_path: '/seller/settings?tab=policies',
        cta_label: 'Configurer les regles',
        auto: false,
    },
    go_live: {
        key: 'go_live',
        title: 'Mettre la boutique en ligne',
        description: 'Activez le mode public depuis votre marque.',
        cta_path: '/seller/store',
        cta_label: 'Activer la boutique',
        auto: true,
    },
};

const ONBOARDING_STEP_KEYS = Object.keys(ONBOARDING_STEPS);

function isShopBrandConfigured(shop) {
    if (!shop) return false;
    return Boolean(
        String(shop.name || '').trim() &&
        String(shop.description || '').trim() &&
        String(shop.logo_url || '').trim()
    );
}

async function getSellerIdByUserId(userId) {
    const { data, error } = await supabase
        .from('sellers')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data?.id || null;
}

// Fetch onboarding data for the authenticated seller
router.get('/seller/onboarding', authLimiter, authenticateUser, async (req, res) => {
    try {
        const user = req.user;
        const sellerId = await getSellerIdByUserId(user.id);

        if (!sellerId) {
            return res.status(404).json({ success: false, message: 'Seller not found.' });
        }

        const [
            { data: shopData, error: shopError },
            { count: paymentMethodsCount, error: paymentMethodsError },
            { data: latestKyc, error: kycError },
            { data: persistedSteps, error: persistedStepsError },
        ] = await Promise.all([
            supabase
                .from('shops')
                .select('id, name, description, logo_url, is_live')
                .eq('seller_id', sellerId)
                .maybeSingle(),
            supabase
                .from('payment_methods')
                .select('id', { count: 'exact', head: true })
                .eq('seller_id', sellerId),
            supabase
                .from('kyc_documents')
                .select('status')
                .eq('seller_id', sellerId)
                .order('submitted_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
            supabase
                .from('seller_onboarding_steps')
                .select('step_key, is_completed, completed_at')
                .eq('seller_id', sellerId)
                .in('step_key', ONBOARDING_STEP_KEYS),
        ]);

        if (shopError) {
            console.error('Onboarding shop error:', shopError);
            return res.status(500).json({ success: false, message: 'Unable to load shop data.' });
        }

        if (!shopData?.id) {
            return res.status(400).json({ success: false, message: 'Shop not found for this seller.' });
        }

        if (paymentMethodsError || kycError) {
            console.error('Onboarding metrics error:', {
                paymentMethodsError,
                kycError,
            });
            return res.status(500).json({ success: false, message: 'Unable to load onboarding metrics.' });
        }

        if (persistedStepsError && persistedStepsError.code !== '42P01') {
            console.error('Onboarding persisted steps error:', persistedStepsError);
            return res.status(500).json({ success: false, message: 'Unable to load onboarding progress.' });
        }

        const [
            { count: productsCountByShop, error: productsByShopError },
            { count: deliveryByShopCount, error: deliveryByShopError },
            { count: pickupByShopCount, error: pickupByShopError },
            { count: locationsByShopCount, error: locationsByShopError },
        ] = await Promise.all([
            supabase
                .from('products')
                .select('id', { count: 'exact', head: true })
                .eq('shop_id', shopData.id),
            supabase
                .from('delivery_options')
                .select('id', { count: 'exact', head: true })
                .eq('shop_id', shopData.id),
            supabase
                .from('pickup_points')
                .select('id', { count: 'exact', head: true })
                .eq('shop_id', shopData.id),
            supabase
                .from('shop_locations')
                .select('id', { count: 'exact', head: true })
                .eq('shop_id', shopData.id),
        ]);

        if (productsByShopError || deliveryByShopError || pickupByShopError || locationsByShopError) {
            console.error('Onboarding per-shop metrics error:', {
                productsByShopError,
                deliveryByShopError,
                pickupByShopError,
                locationsByShopError,
            });
            return res.status(500).json({ success: false, message: 'Unable to load onboarding metrics.' });
        }

        const persistedMap = new Map();
        for (const step of persistedSteps || []) {
            persistedMap.set(step.step_key, step);
        }

        const autoCompletionMap = {
            brand: isShopBrandConfigured(shopData),
            first_product: (productsCountByShop || 0) > 0,
            payment_method: (paymentMethodsCount || 0) > 0,
            kyc_approved: latestKyc?.status === 'approved',
            delivery_zone: ((deliveryByShopCount || 0) + (pickupByShopCount || 0) + (locationsByShopCount || 0)) > 0,
            policies: false,
            go_live: Boolean(shopData.is_live),
        };

        const steps = ONBOARDING_STEP_KEYS.map((stepKey) => {
            const def = ONBOARDING_STEPS[stepKey];
            const persisted = persistedMap.get(stepKey);
            const autoCompleted = Boolean(autoCompletionMap[stepKey]);
            const manualCompleted = Boolean(persisted?.is_completed);
            const completed = autoCompleted || manualCompleted;
            const blockedReason = stepKey === 'go_live' && !autoCompletionMap.kyc_approved
                ? 'KYC non approuve. Finalisez la verification dans Finances avant de mettre la boutique en ligne.'
                : null;

            return {
                key: def.key,
                title: def.title,
                description: def.description,
                cta_path: def.cta_path,
                cta_label: def.cta_label,
                completed,
                auto_completed: autoCompleted,
                manual_completed: manualCompleted,
                can_mark_manual: !def.auto,
                completed_at: persisted?.completed_at || null,
                blocked_reason: blockedReason,
            };
        });

        const completedSteps = steps.filter((step) => step.completed).length;

        return res.status(200).json({
            success: true,
            onboarding: {
                title: 'Configuration de la boutique',
                completed_steps: completedSteps,
                total_steps: steps.length,
                progress_percent: Math.round((completedSteps / steps.length) * 100),
                steps,
            },
        });
    } catch (error) {
        console.error('Onboarding route error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

// Track onboarding events for analytics
router.post('/seller/onboarding/events', authLimiter, authenticateUser, async (req, res) => {
    try {
        const user = req.user;
        const sellerId = await getSellerIdByUserId(user.id);

        if (!sellerId) {
            return res.status(404).json({ success: false, message: 'Seller not found.' });
        }

        const eventType = String(req.body?.event_type || '').trim();
        const stepKey = req.body?.step_key ? String(req.body.step_key).trim() : null;
        const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};

        if (!ONBOARDING_EVENT_TYPES.has(eventType)) {
            return res.status(400).json({ success: false, message: 'Invalid event type.' });
        }

        if (stepKey && !ONBOARDING_STEP_KEYS.includes(stepKey)) {
            return res.status(400).json({ success: false, message: 'Invalid step key.' });
        }

        const { error } = await supabaseAdmin
            .from('seller_onboarding_events')
            .insert({
                seller_id: sellerId,
                event_type: eventType,
                step_key: stepKey,
                metadata,
            });

        if (error) {
            if (error.code === '42P01') {
                return res.status(202).json({ success: true, message: 'Analytics table not ready.' });
            }
            console.error('Onboarding analytics insert error:', error);
            return res.status(500).json({ success: false, message: 'Unable to track onboarding event.' });
        }

        return res.status(201).json({ success: true });
    } catch (error) {
        console.error('Onboarding analytics route error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

// Update manual onboarding step completion for the authenticated seller
router.post('/seller/onboarding/steps/:stepKey', authLimiter, authenticateUser, async (req, res) => {
    try {
        const user = req.user;
        const { stepKey } = req.params;
        const isCompleted = req.body?.is_completed !== false;

        if (!ONBOARDING_STEP_KEYS.includes(stepKey)) {
            return res.status(400).json({ success: false, message: 'Invalid onboarding step.' });
        }

        const stepDef = ONBOARDING_STEPS[stepKey];
        if (stepDef.auto) {
            return res.status(400).json({ success: false, message: 'This step is tracked automatically.' });
        }

        const sellerId = await getSellerIdByUserId(user.id);
        if (!sellerId) {
            return res.status(404).json({ success: false, message: 'Seller not found.' });
        }

        const payload = {
            seller_id: sellerId,
            step_key: stepKey,
            is_completed: isCompleted,
            completed_at: isCompleted ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
        };

        const { error } = await supabaseAdmin
            .from('seller_onboarding_steps')
            .upsert(payload, { onConflict: 'seller_id,step_key' });

        if (error) {
            if (error.code === '42P01') {
                return res.status(500).json({
                    success: false,
                    message: 'Onboarding storage is not ready. Please run database migrations.',
                });
            }
            console.error('Error saving onboarding step:', error);
            return res.status(500).json({ success: false, message: 'Unable to save onboarding step.' });
        }

        return res.status(200).json({ success: true, step_key: stepKey, is_completed: isCompleted });
    } catch (error) {
        console.error('Onboarding step update error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

module.exports = router;