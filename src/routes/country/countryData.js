const express = require('express');
const router = express.Router();
const departmentData = require('../../../country_data/departments.json');
const arrondissementData = require('../../../country_data/arrondissements.json')
const communeData = require('../../../country_data/communes.json')
const sectionData = require('../../../country_data/sections.json')

// GET /department from country_data folder json
router.get('/departments', (req, res) => {
    try {
        const departments = departmentData.map(d => d.name);
        res.status(200).json({ departments });
    } catch (error) {
        console.error("Failed to load departments:", error);
        res.status(500).json({ message: 'Failed to load departments.' });
    }
})


// GET /department/:department_name?/arrondissement from country_data folder json
router.get('/departments/:department/arrondissements', (req, res) => {
    try {
        const { department } = req.params;

        const match = arrondissementData.find(
            item => item.county.toLowerCase() === department.toLowerCase()
        );

        if (!match) {
            return res.status(200).json({
                message: "Department not found"
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
router.get('/departments/:department/arrondissements/:arrondissement/communes', (req, res) => {
    const { arrondissement } = req.params;

    const match = communeData.find(
        item => item.district.toLowerCase() === arrondissement.toLowerCase()
    );

    if (!match) {
        return res.status(404).json({ message: 'Arrondissement not found'})
    }

    const communes = match.municipalities.map( m => m.name);

    res.json({ communes});
})

// GET 
router.get('/departments/:department/arrondissements/:arrondissement/communes/:commune/section', (req, res) => {
    const { commune } = req.params;

    const match = sectionData.find(
        item => item.municipality.toLowerCase() === commune.toLowerCase()
    );

    if (!match) {
        return res.status(404).json({ message: 'Commune not found'})
    }

    const communes = match.submunicipalities.map( s => s.name);

    res.json({ communes});
})

module.exports = router;