const rateLimit = require('express-rate-limit');


// Rate limiter for authentication routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Ip max 10 requests per windowMs
    message: 'Too many requests from this IP, please try again after 15 minutes',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).json({ message: 'Too many requests from this IP, please try again after 15 minutes' }); 
    }
})

// Rate limiter for store routes 
const sellerStoreLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 30, // Ip max 7 requests per windowMs
    message: 'Too many requests from this IP, please try again after a minute',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).json({ message: 'Too many requests from this IP, please try again after a minute from' }); 
    }
})

module.exports = {
    authLimiter,
    sellerStoreLimiter,
}