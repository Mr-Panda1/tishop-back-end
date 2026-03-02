const express = require('express');
const { supabase } = require('../../db/supabase');
const router = express.Router();
const { adminLoginLimiter } = require('../../middlewares/limit');

// Admin login router 
// POST /api/admin/login
router.post('/admin/login', adminLoginLimiter, async (req, res) => {
    try {
        const { email, password, admin_code } = req.body;

        // Verify if inputs are provided
        if (!email || !password || !admin_code) {
            return res.status(400).json({ message: 'Email, password and admin code are required.' });
        }

        // Check if admin exist in admins table FIRST (not users table)
        const { data: adminData, error: adminDataError } = await supabase
        .from('admins')
        .select('*')
        .eq('email', email)
        .maybeSingle();

        if (adminDataError) {
            console.error('Admin lookup error:', adminDataError);
            return res.status(500).json({ message: 'Server error during login.' });
        }

        if (!adminData) {
            return res.status(401).json({ message: 'Invalid email, code or password' });
        }

        // Check if admin is active
        if (!adminData.is_active) {
            return res.status(403).json({ message: 'Admin account is inactive.' });
        }

        // Check if admin code is correct (strict comparison)
        if (adminData.admin_code !== admin_code || !admin_code || !adminData.admin_code) {
            return res.status(401).json({ message: 'Invalid email, code or password' });
        }

        // Check if password is correct
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (authError || !authData) {
            return res.status(401).json({ message: 'Invalid email, code or password' });
        }

        // Update last login time 
        const { error: updateError } = await supabase
        .from('admins')
        .update({ last_login: new Date() })
        .eq('email', email);

        if (updateError) {
            return res.status(401).json({ message: 'Login successful but failed to update last login time.' });
        }

        // Generate a session token
        res.cookie('access_token', authData.session.access_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            maxAge: authData.session.expires_in * 1000,
            path: '/',
            ...(process.env.NODE_ENV === 'production' && { domain: 'admin.tishop.co' })
        })

        if (authData.session.refresh_token) {
            res.cookie("refresh_token", authData.session.refresh_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                maxAge: 7 * 24 * 3600000,
                path: '/',
                ...(process.env.NODE_ENV === 'production' && { domain: 'admin.tishop.co' })
            });
        }

        const response = {
            message: "Login successful",
            user: authData.user,
            access_token: authData.session.access_token,
            refresh_token: authData.session.refresh_token
        }

        return res.status(200).json(response);
    } catch (error) {
        console.error("Login request error:", error.message);
        return res.status(500).json({ message: 'An error occurred during login.' });
    }
})

// Admin code verification router 
// POST /api/admin/verify-code
router.post('/admin/verify-code', async (req, res) => {
    try {
        const { admin_code } = req.body;

        if (!admin_code) {
            return res.status(400).json({ message: 'Admin code is required.', success: false });
        }
        // Check if admin code exist in admins table
        const { data: adminData, error: adminDataError } = await supabase
        .from('admins')
        .select('*')
        .eq('admin_code', admin_code)
        .single();

        if (adminDataError || !adminData) {
            return res.status(404).json({ message: 'Invalid admin code', success: false });
        }

        return res.status(200).json({ message: 'Admin code is valid.', success: true });
    } catch (error) {
        console.error("Error getting the admin code:", error.message);
        return res.status(500).json({ message: 'An error occurred while verifying the admin code.', success: false });
    }
})

module.exports = router;