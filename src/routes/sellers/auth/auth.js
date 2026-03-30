const express = require('express')
const { supabase, supabaseAdmin } = require('../../../db/supabase');
const router = express.Router();
const { authLimiter } = require('../../../middlewares/limit');
const { sendWelcomeEmail } = require('../../../email/seller/welcomeEmail');
const crypto = require('crypto');
const { validatePassword } = require('../../../utils/passwordValidator');
const authenticateUser = require('../../../middlewares/authMiddleware');

// Seller login route 
// POST /api/seller/login
router.post('/seller/login', authLimiter, async (req, res) => {
    try {
        // Safely handle cases where req.body is undefined
        const { email, password } = req.body || {};
        const normalizedEmail = String(email || '').trim().toLowerCase();

        // Verify if inpuits are provided
        if (!normalizedEmail || !password) {
            return res.status(400).json({ message: 'L\'adresse e-mail et le mot de passe sont requis.' });
        }

        // Check if email exists for a seller account (admin client avoids RLS false negatives)
        const { data: seller, error: sellerError } = await supabaseAdmin
        .from('users')
        .select('email, role, is_active')
        .ilike('email', normalizedEmail)
        .maybeSingle();

        if (sellerError || !seller) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        if (seller.role && seller.role !== 'seller') {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        if (seller.is_active === false) {
            return res.status(403).json({ message: 'Votre compte est inactif.' });
        }

        // Sign in the seller
        const { data, error } = await supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password
        });

        if (error) {

            // Debugging
            console.log("Login error:", error.message);

            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        res.cookie('access_token', data.session.access_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            maxAge: data.session.expires_in * 1000,
            path: '/',
            ...(process.env.NODE_ENV === 'production' && { domain: '.tishop.co' })
        })
        
        if (data.session.refresh_token) {
            res.cookie("refresh_token", data.session.refresh_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                maxAge: 7 * 24 * 3600000,
                path: '/',
                ...(process.env.NODE_ENV === 'production' && { domain: '.tishop.co' })
            });
        }
        const response = {
            message: "Connexion réussie",
            user: data.user,
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token
        }

        return res.status(200).json(response);

    } catch (error) {
        console.log("Login request error:", error.message);
        
        return res.status(500).json({ message: 'Erreur serveur interne.' });
    }
})

const generateRandomName = (length = 8) => {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.randomBytes(length);
    return Array.from(bytes)
        .map((b) => charset[b % charset.length])
        .join('');
}

// Seller sign up route
// POST /api/seller/signup
router.post('/seller/signup', authLimiter, async (req, res) => {
    try {
        console.log('=== SIGNUP REQUEST START ===');
        console.log('Request body received:', {
            hasBody: !!req.body,
            bodyType: typeof req.body,
            keys: req.body ? Object.keys(req.body) : [],
            contentType: req.get('Content-Type'),
            userAgent: req.get('User-Agent')
        });

        const { first_name, last_name, email, password } = req.body || {};

        console.log('Parsed fields:', {
            hasFirstName: !!first_name,
            hasLastName: !!last_name,
            hasEmail: !!email,
            hasPassword: !!password,
            firstNameType: typeof first_name,
            lastNameType: typeof last_name,
            emailType: typeof email
        });

        // Verify if inputs are provided
        if (!first_name || !last_name || !email || !password) {
            console.log('VALIDATION FAILED: Missing required fields');
            return res.status(400).json({ 
                message: 'Tous les champs sont requis.',
                missing: {
                    first_name: !first_name,
                    last_name: !last_name,
                    email: !email,
                    password: !password
                }
            });
        }

        // Verify if password meet supabase criteria
        const passwordValidation = validatePassword(password);
        if (!passwordValidation.isValid) {
            console.log('VALIDATION FAILED: Password does not meet criteria');
            return res.status(400).json({ 
                message: `${passwordValidation.errors}`,
            });
        }

        console.log('Step 1: Checking for existing email...');
        // See if email already exists
        const { data: existingUser, error: existingUserError } = await supabaseAdmin
        .from('users')
        .select('email')
        .eq('email', email)
        .single();
        
        if (existingUser && !existingUserError) {
            console.log('CONFLICT: Email already exists');
            return res.status(409).json({ message: 'Identifiants invalides.' });
        }

        console.log('Step 2: Creating auth user...');
        // Create new user
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
        })
        
        if (error) {
            console.error("SUPABASE AUTH ERROR:", {
                message: error.message,
                status: error.status,
                name: error.name
            });
            return res.status(400).json({ 
                message: 'Erreur lors de la création du compte utilisateur.',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }

        if (!data?.user?.id) {
            console.error("AUTH USER MISSING: No user ID returned");
            return res.status(400).json({ message: 'Erreur lors de la création du compte utilisateur - pas d\'ID utilisateur.' });
        }

        console.log('Step 3: Auth user created, ID:', data.user.id);
        console.log('Step 4: Inserting into users table...');
        // Insert seller details into 'users' table 
        const { error: userError } = await supabaseAdmin
        .from('users')
        .insert([
            { 
                id: data.user.id,
                first_name, 
                last_name, 
                email, 
                role: 'seller' }
        ])
        .select()
        .single();

        if (userError) {
            console.error("USERS TABLE ERROR:", {
                message: userError.message,
                code: userError.code,
                details: userError.details
            });
            return res.status(500).json({ 
                message: 'Erreur lors de l\'enregistrement des détails de l\'utilisateur.',
                details: process.env.NODE_ENV === 'development' ? userError.message : undefined
            });
        }

        console.log('Step 5: Inserting into sellers table...');
        // Add the user to sellers, shops, and balances tables
        const { data: sellerData, error: sellerError } = await supabaseAdmin
        .from('sellers')
        .insert({ 
            user_id: data.user.id,
            first_name,
            last_name,
            email,
          })
        .select('id')
        .single();

        if (sellerError) {
            console.error("SELLERS TABLE ERROR:", {
                message: sellerError.message,
                code: sellerError.code,
                details: sellerError.details
            });
            return res.status(500).json({ 
                message: 'Erreur lors de la création du profil vendeur.',
                details: process.env.NODE_ENV === 'development' ? sellerError.message : undefined
            });
        }

        console.log('Step 6: Seller created, ID:', sellerData.id);
        console.log('Step 7: Creating shop...');
        const { error: shopError } = await supabaseAdmin
        .from('shops')
        .insert({ 
            seller_id: sellerData.id,
            is_live: false,
            name: `${generateRandomName()}'s shop`,
        })
        .select()
        .single();
        
        if (shopError) {
            console.error("SHOPS TABLE ERROR:", {
                message: shopError.message,
                code: shopError.code,
                details: shopError.details
            });
            return res.status(500).json({ 
                message: 'Erreur lors de la création de la boutique.',
                details: process.env.NODE_ENV === 'development' ? shopError.message : undefined
            });
        }

        console.log('Step 8: Creating balance record...');
        const { error: balanceError } = await supabaseAdmin
        .from('balances')
        .insert({ seller_id: sellerData.id })
        .select()
        .single();

        if (balanceError) {
            console.error("BALANCES TABLE ERROR:", {
                message: balanceError.message,
                code: balanceError.code,
                details: balanceError.details
            });
            return res.status(500).json({ 
                message: 'Erreur lors de la création du compte de solde.',
                details: process.env.NODE_ENV === 'development' ? balanceError.message : undefined
            });
        }

        // Send welcome email
        console.log('Step 9: Sending welcome email...');
        try {
            await sendWelcomeEmail(email, `${first_name} ${last_name}`);
            console.log("Welcome email sent to:", email);
        } catch (emailError) {
            console.log("Warning: Failed to send welcome email:", emailError.message);
        }

        console.log('=== SIGNUP SUCCESS ===');
        const response = {
            message: "Utilisateur créé avec succès. Veuillez vérifier votre adresse e-mail avant de vous connecter.",
            user: data.user,
        }

        return res.status(201).json(response);
    } catch (error) {
        console.error("=== SIGNUP FATAL ERROR ===");
        console.error("Error stack:", error.stack);
        console.error("Error message:", error.message);
        return res.status(500).json({ 
            message: 'Erreur serveur interne.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
})


// Update seller profile names route
// PATCH /api/seller/profile
router.patch('/seller/profile', authenticateUser, async (req, res) => {
    try {
        const userId = req.user?.id;
        const first_name = String(req.body?.first_name || '').trim();
        const last_name = String(req.body?.last_name || '').trim();

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized: Invalid or expired token.' });
        }

        if (!first_name || !last_name) {
            return res.status(400).json({ message: 'Le prénom et le nom sont requis.' });
        }

        if (first_name.length > 100 || last_name.length > 100) {
            return res.status(400).json({ message: 'Le prénom ou le nom est trop long.' });
        }

        const { error: userUpdateError } = await supabase
            .from('users')
            .update({
                first_name,
                last_name,
                updated_at: new Date().toISOString(),
            })
            .eq('id', userId);

        if (userUpdateError) {
            console.error('Error updating users profile:', userUpdateError);
            return res.status(500).json({ message: 'Erreur lors de la mise à jour du profil.' });
        }

        const { error: sellerUpdateError } = await supabase
            .from('sellers')
            .update({
                first_name,
                last_name,
                updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId);

        if (sellerUpdateError) {
            console.error('Error updating sellers profile:', sellerUpdateError);
            return res.status(500).json({ message: 'Erreur lors de la synchronisation du profil vendeur.' });
        }

        const { data: updatedUser, error: profileError } = await supabase
            .from('users')
            .select('id, email, first_name, last_name, role')
            .eq('id', userId)
            .maybeSingle();

        if (profileError) {
            console.error('Error fetching updated user profile:', profileError);
            return res.status(500).json({ message: 'Profil mis à jour, mais impossible de récupérer les données.' });
        }

        return res.status(200).json({
            message: 'Profil mis à jour avec succès.',
            user: updatedUser,
        });
    } catch (error) {
        console.error('Profile update request error:', error);
        return res.status(500).json({ message: 'Erreur serveur interne.' });
    }
});


// Seller logout route
// POST /api/seller/logout
router.post('/seller/logout', async (req, res) => {
    try {
        const accessToken = req.cookies?.access_token;

        if (accessToken) {
            await supabaseAdmin.auth.admin.signOut(accessToken);
        }
    } catch (error) {
        console.log("Logout warning:", error.message);
    }

    const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        path: '/',
        ...(process.env.NODE_ENV === 'production' && { domain: '.tishop.co' })
    };

    res.clearCookie('access_token', cookieOptions);
    res.clearCookie('refresh_token', cookieOptions);

    return res.status(200).json({ message: 'Déconnexion réussie.' });
});

module.exports = router;