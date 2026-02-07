const express = require('express');
const supabase = require('../db/supabase');
const router = express.Router();

router.get('/verify-user', async (req, res) => {
    try {
        const token = req.cookies.access_token;
        if (!token) {
            return res.status(401).json({ authenticated: false });
        }

        const { data: { user }, error } = await supabase.auth.getUser(token)

        if (error || !user) {
            return res.status(401).json({ authenticated: false });
        }

        // fetch role 
        const { data: profile, error: profileError } = await 
        supabase
        .from('users')
        .select('role, first_name, last_name, is_active')
        .eq('id', user.id)
        .single();

        if (profileError || !profile) {
            return res.status(500).json({ authenticated: false });
        }

        return res.status(200).json({
            authenticated: true,
            user: {id: user.id, email: user.email },
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