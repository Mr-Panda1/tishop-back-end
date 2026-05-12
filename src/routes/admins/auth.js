const express = require('express');
const { supabase } = require('../../db/supabase');
const router = express.Router();
const { adminLoginLimiter } = require('../../middlewares/limit');
const { decryptFields } = require('../../utils/encryption');

const ADMIN_ENCRYPTED_FIELDS = ['first_name', 'last_name', 'phone'];
const normalizeAdminCode = (value) => String(value || '').trim().toUpperCase();

// Admin login router 
// POST /api/admin/login
router.post('/admin/login', adminLoginLimiter, async (req, res) => {
    try {
        console.log('📍 Admin login request received');
        console.log('📍 Request body:', { 
            email: req.body?.email, 
            password: req.body?.password ? '***' : undefined, 
            admin_code: req.body?.admin_code ? '***' : undefined 
        });

        const { email, password, admin_code } = req.body;
        const normalizedAdminCode = normalizeAdminCode(admin_code);

        // Verify if inputs are provided
        if (!email || !password || !normalizedAdminCode) {
            console.log('❌ Missing required fields:', { email: !!email, password: !!password, admin_code: !!admin_code });
            return res.status(400).json({ message: 'Email, password and admin code are required.' });
        }

        console.log('📍 Checking password first (RLS-safe login flow)...');

        // Check if password is correct
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (authError || !authData) {
            console.error('❌ Password check failed:', authError?.message);
            return res.status(401).json({ message: 'Invalid email, code or password' });
        }

        // Verify admin profile after sign-in so RLS can rely on authenticated context.
        const { data: adminData, error: adminDataError } = await supabase
            .from('admins')
            .select('*')
            .eq('email', email)
            .maybeSingle();

        if (adminDataError) {
            console.error('❌ Admin lookup error:', adminDataError);
            await supabase.auth.signOut();
            return res.status(500).json({ message: 'Server error during login.' });
        }

        if (!adminData) {
            await supabase.auth.signOut();
            return res.status(401).json({ message: 'Invalid email, code or password' });
        }

        const decryptedAdmin = decryptFields(adminData, ADMIN_ENCRYPTED_FIELDS);

        // Check if admin is active
        if (!decryptedAdmin.is_active) {
            console.log('❌ Admin account is inactive');
            await supabase.auth.signOut();
            return res.status(403).json({ message: 'Admin account is inactive.' });
        }

        // Check if admin code is correct (plaintext for now).
        if (normalizeAdminCode(decryptedAdmin.admin_code) !== normalizedAdminCode) {
            console.log('❌ Admin code validation failed');
            await supabase.auth.signOut();
            return res.status(401).json({ message: 'Invalid email, code or password' });
        }

        console.log('📍 Password verified, updating last login...');

        // Update last login time 
        const { error: updateError } = await supabase
        .from('admins')
        .update({ last_login: new Date() })
        .eq('email', email);

        if (updateError) {
            console.error('❌ Update last login error:', updateError);
            return res.status(401).json({ message: 'Login successful but failed to update last login time.' });
        }

        console.log('📍 Setting cookies...');

        // Generate a session token
        res.cookie('access_token', authData.session.access_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            maxAge: authData.session.expires_in * 1000,
            path: '/',
        })

        if (authData.session.refresh_token) {
            res.cookie("refresh_token", authData.session.refresh_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                maxAge: 7 * 24 * 3600000,
                path: '/',
            });
        }

        const response = {
            message: "Login successful",
            user: authData.user,
            access_token: authData.session.access_token,
            refresh_token: authData.session.refresh_token
        }

        console.log('✅ Login successful, sending response');
        return res.status(200).json(response);
    } catch (error) {
        console.error("❌ Login request error:", error.message);
        console.error("❌ Error stack:", error.stack);
        return res.status(500).json({ message: 'An error occurred during login.' });
    }
})

// Admin code verification router 
// POST /api/admin/verify-code
router.post('/admin/verify-code', async (req, res) => {
    try {
        const cookieToken = req.cookies.access_token;
        const authHeader = req.headers.authorization;
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const token = cookieToken || bearerToken;

        if (!token) {
            return res.status(401).json({ message: 'Unauthorized', success: false });
        }

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user?.email) {
            return res.status(401).json({ message: 'Unauthorized', success: false });
        }

        const normalizedAdminCode = normalizeAdminCode(req.body?.admin_code);

        if (!normalizedAdminCode) {
            return res.status(400).json({ message: 'Admin code is required.', success: false });
        }

        // Check against current authenticated admin profile only.
        const { data: adminData, error: adminDataError } = await supabase
            .from('admins')
            .select('id, email, admin_code, is_active')
            .eq('email', user.email)
            .maybeSingle();

        if (adminDataError || !adminData) {
            return res.status(403).json({ message: 'Forbidden', success: false });
        }

        if (!adminData.is_active) {
            return res.status(403).json({ message: 'Admin account is inactive.', success: false });
        }

        if (normalizeAdminCode(adminData.admin_code) !== normalizedAdminCode) {
            return res.status(404).json({ message: 'Invalid admin code', success: false });
        }

        return res.status(200).json({ message: 'Admin code is valid.', success: true });
    } catch (error) {
        console.error("Error getting the admin code:", error.message);
        return res.status(500).json({ message: 'An error occurred while verifying the admin code.', success: false });
    }
})

module.exports = router;