const { supabase } = require('../db/supabase');

const authenticateUser = async (req, res, next) => {
    try {
        const token = req.cookies.access_token;

        if (!token) {
            return res.status(401).json({ 
                message: 'Unauthorized: No token provided.',
                authenticated: false,
            });
        }

        // Verify token 
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({ 
                message: 'Unauthorized: Invalid or expired token.',
                authenticated: false,
            });
        }

        // Attach user to request object
        req.user = user;
        next();
    } catch (error) {
        console.error("Auth middleware error:", error);
        return res.status(500).json({ 
            message: 'Internal server error.',
            authenticated: false,
        });
    }
}


module.exports = authenticateUser;