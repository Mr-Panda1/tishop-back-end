const { supabase } = require('../db/supabase');
const { decryptFields } = require('../utils/encryption');

const ADMIN_ENCRYPTED_FIELDS = ['first_name', 'last_name', 'phone'];

const authenticateAdmin = async (req, res, next) => {
    try {
        const cookieToken = req.cookies.access_token;
        const authHeader = req.headers.authorization;
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const token = cookieToken || bearerToken;

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

        // Check if user exists in admin table 
        const { data: adminData, error: adminError } = await supabase
        .from('admins')
        .select('*')
        .eq('email', user.email)
        .single();

        if (adminError || !adminData) {
            return res.status(403).json({ 
                message: 'Forbidden: You do not have access to this resource.',
                authenticated: false,
            });
        }

        const decryptedAdmin = decryptFields(adminData, ADMIN_ENCRYPTED_FIELDS);

        // Check if admin is active 
        if (!decryptedAdmin.is_active) {
            return res.status(403).json({
                message: 'Forbidden: Your admin account is deactivated. Please contact support.',
                authenticated: false,
            })
        }
        // Attach user to request object
        req.user = user;
        req.admin = decryptedAdmin;
        next();
    } catch (error) {
        console.error("Auth middleware error:", error);
        return res.status(500).json({ 
            message: 'Internal server error.',
            authenticated: false,
        });
    }
}

// Check specific role(s)
const requireRole = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.admin) {
            return res.status(403).json({ 
                message: 'Forbidden: Admin authentication required.',
            });
        }

        if (!allowedRoles.includes(req.admin.role)) {
            return res.status(403).json({ 
                message: `Forbidden: Requires one of: ${allowedRoles.join(', ')}`,
                requiredRoles: allowedRoles,
                yourRole: req.admin.role
            });
        }

        next();
    };
};

module.exports = { 
    authenticateAdmin,
    requireRole
};