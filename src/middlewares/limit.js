const rateLimit = require('express-rate-limit');


// Rate limiter for authentication routes (only failed attempts count)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // max 10 failed requests per IP per windowMs
    skipSuccessfulRequests: true,
    message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 15 minutes',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).json({ message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 15 minutes' }); 
    }
})

// Rate limiter for store management routes (shop settings, locations, delivery, pickup)
const sellerStoreLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 60, // max 60 requests per IP per windowMs
    message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 5 minutes',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).json({ message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 5 minutes' }); 
    }
})

// Rate limiter for product create/update/delete (image uploads are resource-intensive)
const sellerProductLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 15, // max 15 write operations per IP per windowMs
    message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 10 minutes',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).json({ message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 10 minutes' }); 
    }
})

// Rate limiter for kyc routes 
const sellerKYCLimiter = rateLimit({
    windowMs: 1440 * 60 * 1000, // 24 hours
    max: 5, // max 5 requests per IP per windowMs
    message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 24 heures',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).json({ message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 24 heures' }); 
    }
})

// Rate limiter for public/general routes 
const generalLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 120, // max 120 requests per IP per windowMs
    message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 10 minutes',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).json({ message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 10 minutes' }); 
    }
})

// Rate limiter for admin login (only failed attempts count)
const adminLoginLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 5, // max 5 failed requests per IP per windowMs
    skipSuccessfulRequests: true,
    message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 10 minutes',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).json({ message: 'Trop de requêtes depuis cette adresse IP, veuillez réessayer après 10 minutes' }); 
    }
})

module.exports = {
    authLimiter,
    sellerStoreLimiter,
    sellerProductLimiter,
    sellerKYCLimiter,
    generalLimiter,
    adminLoginLimiter
}