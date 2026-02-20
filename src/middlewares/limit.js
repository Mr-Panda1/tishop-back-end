const rateLimit = require('express-rate-limit');


// Rate limiter for authentication routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Ip max 10 requests per windowMs
    message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 15 minutes',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).json({ message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 15 minutes' }); 
    }
})

// Rate limiter for store routes 
const sellerStoreLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 30, // Ip max 30 requests per windowMs
    message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 5 minutes',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).json({ message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 5 minutes' }); 
    }
})

// Rate limiter for kyc routes 
const sellerKYCLimiter = rateLimit({
    windowMs: 1440 * 60 * 1000, // 24 hours
    max: 5, // Ip max 3 requests per windowMs
    message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 24 heures',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).json({ message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 24 heures' }); 
    }
})

module.exports = {
    authLimiter,
    sellerStoreLimiter,
    sellerKYCLimiter,
}