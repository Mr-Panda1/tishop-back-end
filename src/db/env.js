const dotenv = require('dotenv');
dotenv.config();

// Required environment variables validation
const requiredEnvVars = ['SUPABASE_URL', 'JWT'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('Missing required environment variables:', missingVars.join(', '));
    console.error('Please add these variables to your .env file');
    process.exit(1);
}

const env = {
    port: Number(process.env.PORT) || 3000,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseSecret: process.env.SUPABASE_SECRET || process.env.SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET,
    jwtSecret: process.env.JWT,
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    clientId: process.env.MONCASH_CLIENT_ID,
    clientsecret: process.env.MONCASH_CLIENT_SECRET,
    moncashMode: process.env.MONCASH_MODE || 'sandbox',
    moncashCallbackUrl: process.env.MONCASH_CALLBACK_URL || 'https://pay.tishop.co/api/payments/callback',

    // Email (Brevo/Sendinblue) configuration
    host: process.env.BREVO_SMTP_HOST || "smtp-relay.brevo.com",
    port: parseInt(process.env.BREVO_SMTP_PORT) || 587,
    user: process.env.BREVO_EMAIL_USER,
    pass: process.env.BREVO_EMAIL_PASS,
    emailPass: process.env.BREVO_EMAIL_PASS,
    fromEmail: process.env.BREVO_FROM_EMAIL,
    fromName:  "TiShop",
}

if (!env.supabaseSecret) {
    console.error('Missing required environment variable: SUPABASE_SECRET or SUPABASE_ANON_KEY');
    console.error('Please add one of these variables to your .env file');
    process.exit(1);
}

if (!env.supabaseServiceRoleKey) {
    console.error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
    console.error('Please add this variable to your .env file');
    process.exit(1);
}

console.log('Environment variables validated successfully');
module.exports = env;