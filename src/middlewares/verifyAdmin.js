const express = require('express');
const { supabase } = require('../db/supabase');
const { decryptFields } = require('../utils/encryption');
const router = express.Router();

const ADMIN_ENCRYPTED_FIELDS = ['first_name', 'last_name', 'phone'];

router.get('/verify-admin', async (req, res) => {
    try {
        const cookieToken = req.cookies.access_token;
        const authHeader = req.headers.authorization;
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const token = cookieToken || bearerToken;
        if (!token) {
            return res.status(401).json({ authenticated: false });
        }

        const { data: { user }, error } = await supabase.auth.getUser(token)

        if (error || !user) {
            return res.status(401).json({ authenticated: false });
        }

        const { data: profile, error: profileError } = await supabase
            .from('admins')
            .select('id, role, first_name, last_name, email, is_active, department')
            .eq('email', user.email)
            .maybeSingle();
        
        if (profileError) {
            console.error('Profile query error:', profileError.message);
            return res.status(500).json({ authenticated: false });
        }

        if (!profile) {
            return res.status(403).json({
                authenticated: false,
                message: 'Forbidden: admin access required.'
            });
        }

        if (!profile.is_active) {
            return res.status(403).json({
                authenticated: false,
                message: 'Forbidden: admin account is inactive.'
            });
        }

        const decryptedProfile = decryptFields(profile, ADMIN_ENCRYPTED_FIELDS);

        return res.status(200).json({
            authenticated: true,
            user: { id: user.id, email: user.email },
            admin: {
                id: decryptedProfile.id,
                email: decryptedProfile.email,
                department: decryptedProfile.department
            },
            role: decryptedProfile.role,
            first_name: decryptedProfile.first_name,
            last_name: decryptedProfile.last_name,
            is_active: decryptedProfile.is_active,
        });
    } catch (error) {
        console.error("Verify error:", error);
        return res.status(500).json({ authenticated: false });
    }
})


module.exports = router;