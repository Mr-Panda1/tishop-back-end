const env  = require('./db/env');
const express = require('express');
const app = express();
const cors = require('cors');
const cookieParser = require('cookie-parser');

// Trust proxy
app.set('trust proxy', 1); 

// Log requests
app.use((req, res, next) => {
    console.log('Incoming request:', {
        method: req.method,
        url: req.url,
        headers: req.headers,
        origin: req.get('origin')
    });
    next();
});

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// CORS configuration
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8000',
    'http://192.168.1.66:3000',
    'http://192.168.1.66:8000',
    'http://192.168.1.66:3001',
    'https://tishop.co',
    'https://www.tishop.co',
    'https://seller.tishop.co',
];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`CORS blocked origin: ${origin}`);
            callback(new Error('CORS not allowed'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Health check route
app.get('/health', async (req, res) => {
    let databaseStatus = 'down';
    try {
        const { error } = await supabase.from('users').select('id').limit(1);
        if (!error) {
            databaseStatus = 'up';
        } else {
            console.error('Health check DB error:', error);
        }
    } catch (error) {
        console.error('Health check DB exception:', error);
    }

    res.status(databaseStatus === 'up' ? 200 : 503).json({ 
        status: databaseStatus === 'up' ? 'ok' : 'degraded', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0',
        services: {
            database: databaseStatus
        }
    });
});

// Routes
console.log("Registering routes...");
// seller
app.use('/api', require('./routes/sellers/auth/auth'));
app.use('/api/middleware', require('./middlewares/verifyUser'));
app.use('/data', require('./routes/country/countryData'));
app.use('/seller/shop/brand', require('./routes/sellers/shop/shop'));
app.use('/seller/shop/product', require('./routes/sellers/shop/products'));
app.use('/seller/kyc', require('./routes/sellers/kyc/kyc'));
app.use('/seller/orders', require('./routes/sellers/orders'));
app.use('/seller', require('./routes/sellers/payout/payouts'));
app.use('/api/payments', require('./routes/payments/payments'));

// customer
// app.use('/api/customer/auth', require('./routes/customers/auth/auth'));
app.use('/customer/shop/category', require('./routes/customers/category'));
// app.use('/customer/shop/product', require('./routes/customers/products'));
app.use('/customer/orders', require('./routes/customers/orders'));

// Verify supabase connection
const { supabase } = require('./db/supabase');
const testSupabase = async () => {
    try {
        console.log('Testing supabase connection...');
        const { error } = await supabase.from('users').select('id').limit(1);

        if (error) {
            console.log("Supabase query error:", error);
            throw error;
        }
        console.log("Supabase connection verified successfully");
        return true;
    } catch (error) {
        console.error("Supabase connection error:", error);
        return false;
    }
}

// Start server function
const startServer = async () => {
    try {
        console.log("Starting TiShop backend...");
        
        const supabaseOk = await testSupabase();
        if (!supabaseOk) {
            console.error("Cannot start server: Supabase connection failed");
            process.exit(1);
        }

        const server = app.listen(env.port, '0.0.0.0', () => {
            console.log(`Server is running on port ${env.port}`);
            console.log("Ready to accept connections from all interfaces!");
            console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
        })
        return server;
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
}

// Invoke start server
let server;
startServer().then(s => {
    server = s;
}).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.info('SIGTERM signal received.');
    if (server) {
        server.close(() => {
            console.log('Server closed gracefully');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});