const express = require('express');
const router = express.Router();
const { supabase } = require('../../db/supabase');
const { generalLimiter } = require('../../middlewares/limit');

// Fetch all categories with products
router.get('/categories-with-products', generalLimiter, async (req, res) => {
    try {
        // Fetch all parent categories
        const { data: parentCategories, error: parentError } = await supabase
            .from('categories')
            .select('*')
            .is('parent_id', null);

        if (parentError) {
            return res.status(500).json({ message: 'Erreur lors de la récupération des catégories parentes' });
        }

        // Fetch all subcategories
        const { data: subCategories, error: subError } = await supabase
            .from('categories')
            .select('*')
            .not('parent_id', 'is', null);

        if (subError) {
            return res.status(500).json({ message: 'Erreur lors de la récupération des sous-catégories' });
        }

        // Fetch all products
        const { data: products, error: prodError } = await supabase
            .from('products')
            .select('id, name, category_id');

        if (prodError) {
            return res.status(500).json({ message: 'Erreur lors de la récupération des produits' });
        }

        // Map subcategories to their products
        const subIdToProducts = {};
        for (const product of products) {
            if (!subIdToProducts[product.category_id]) subIdToProducts[product.category_id] = [];
            subIdToProducts[product.category_id].push({ id: product.id, name: product.name });
        }

        // Only keep subcategories that have products
        const filteredSubs = subCategories.filter(sub => subIdToProducts[sub.id] && subIdToProducts[sub.id].length > 0);

        // Map parent categories to their subs (with products)
        const parentIdToSubs = {};
        for (const sub of filteredSubs) {
            if (!parentIdToSubs[sub.parent_id]) parentIdToSubs[sub.parent_id] = [];
            parentIdToSubs[sub.parent_id].push({
                id: sub.id,
                name: sub.name,
                products: subIdToProducts[sub.id] || []
            });
        }

        // Only keep parent categories that have at least one subcategory with products
        const filteredParents = parentCategories.filter(parent => parentIdToSubs[parent.id] && parentIdToSubs[parent.id].length > 0);

        // Build the final nested structure
        const result = filteredParents.map(parent => ({
            id: parent.id,
            name: parent.name,
            subs: parentIdToSubs[parent.id]
        }));

        return res.json({ categories: result });
    } catch (error) {
        return res.status(500).json({ message: 'Erreur serveur interne' });
    }
})

module.exports = router;