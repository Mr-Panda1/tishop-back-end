const express = require('express');
const router = express.Router();
const departmentData = require('../../../country_data/departments.json');
const arrondissementData = require('../../../country_data/arrondissements.json')
const communeData = require('../../../country_data/communes.json')
const { supabase } = require('../../db/supabase')
const { generalLimiter } = require('../../middlewares/limit')

// GET /department from country_data folder json
router.get('/departments', generalLimiter, (req, res) => {
    try {
        const departments = departmentData.map(d => d.name);
        res.status(200).json({ departments });
    } catch (error) {
        console.error("Failed to load departments:", error);
        res.status(500).json({ message: 'Erreur lors du chargement des départements.' });
    }
})


// GET /department/:department_name?/arrondissement from country_data folder json
router.get('/departments/:department/arrondissements', generalLimiter, (req, res) => {
    try {
        const { department } = req.params;

        const match = arrondissementData.find(
            item => item.county.toLowerCase() === department.toLowerCase()
        );

        if (!match) {
            return res.status(200).json({
                message: "Département introuvable"
            })
        }

        const arrondissements = match.districts.map(d => d.name);

        res.json({
            arrondissements
        })
    } catch (error) {
        
    }
})

// GET /department/:department_name?/arrondissement/:arrondissement?/communes
router.get('/departments/:department/arrondissements/:arrondissement/communes', generalLimiter, (req, res) => {
    const { arrondissement } = req.params;

    const match = communeData.find(
        item => item.district.toLowerCase() === arrondissement.toLowerCase()
    );

    if (!match) {
        return res.status(404).json({ message: 'Arrondissement introuvable'})
    }

    const communes = match.municipalities.map( m => m.name);

    res.json({ communes});
})

// GET /delivery-fee?commune=COMMUNE_NAME - returns dynamic delivery fee based on commune
router.get('/delivery-fee', generalLimiter, async (req, res) => {
    try {
        const { commune } = req.query;

        if (!commune) {
            return res.status(400).json({
                message: "Le paramètre commune est requis"
            });
        }

        // Find the minimum delivery fee for this commune from active delivery options
        const { data: deliveryOptions, error } = await supabase
            .from('delivery_options')
            .select('price')
            .eq('commune_id', commune)
            .eq('is_active', true)
            .order('price', { ascending: true })
            .limit(1);

        if (error) {
            console.error('Error fetching delivery options:', error);
            return res.status(500).json({
                message: "Erreur lors de la récupération des frais de livraison"
            });
        }

        // Use the minimum price if available, otherwise default to 200
        const deliveryFee = deliveryOptions && deliveryOptions.length > 0 ? parseFloat(deliveryOptions[0].price) : 200;

        res.status(200).json({
            message: "OK",
            data: {
                commune,
                fee: deliveryFee,
                found: true
            }
        });
    } catch (error) {
        console.error("Error fetching delivery fee:", error);
        res.status(500).json({
            message: "Failed to fetch delivery fee"
        });
    }
});

module.exports = router;