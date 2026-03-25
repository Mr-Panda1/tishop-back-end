const express = require('express');
const { supabase } = require('../db/supabase');
const router = express.Router();

router.get('/verify-user', async (req, res) => {
    try {
        let token = req.cookies.access_token;
        const refreshToken = req.cookies.refresh_token;
        let user = null;

        const cookieOptions = {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            path: '/',
            ...(process.env.NODE_ENV === 'production' && { domain: '.tishop.co' })
        };

        if (!token && refreshToken) {
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
                refresh_token: refreshToken
            });

            if (!refreshError && refreshData?.session?.access_token) {
                token = refreshData.session.access_token;
                user = refreshData.user || refreshData.session.user;

                res.cookie('access_token', refreshData.session.access_token, {
                    ...cookieOptions,
                    maxAge: 60 * 60 * 1000
                });

                if (refreshData.session.refresh_token) {
                    res.cookie('refresh_token', refreshData.session.refresh_token, {
                        ...cookieOptions,
                        maxAge: 7 * 24 * 3600000
                    });
                }
            }
        }

        if (!user && token) {
            const { data, error } = await supabase.auth.getUser(token)
            if (!error && data?.user) {
                user = data.user;
            }
        }

        if (!user) {
            return res.status(401).json({ authenticated: false });
        }

        // fetch role from users table
        const { data: profile, error: profileError } = await 
        supabase
        .from('users')
        .select('role, first_name, last_name, is_active')
        .eq('id', user.id)
        .maybeSingle(); // Changed from .single() to handle missing user gracefully

        if (profileError) {
            console.error('Profile query error:', profileError.message);
            return res.status(500).json({ authenticated: false });
        }

        if (!profile) {
            // User exists in auth but not in users table - create default entry
            console.warn(`User ${user.id} not found in users table, creating entry...`);
            const { error: insertError } = await supabase
                .from('users')
                .insert([{ id: user.id, email: user.email, role: 'seller' }])
                .select()
                .single();
            
            if (insertError) {
                console.error('Error creating user entry:', insertError.message);
                return res.status(500).json({ authenticated: false });
            }

            return res.status(200).json({
                authenticated: true,
                user: { id: user.id, email: user.email },
                role: 'seller',
                first_name: null,
                last_name: null,
                is_active: true,
            });
        }

        return res.status(200).json({
            authenticated: true,
            user: { id: user.id, email: user.email },
            role: profile.role,
            first_name: profile.first_name,
            last_name: profile.last_name,
            is_active: profile.is_active,
        });
    } catch (error) {
        console.error("Verify error:", error);
        return res.status(500).json({ authenticated: false });
    }
})


module.exports = router;