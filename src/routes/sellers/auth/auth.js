const express = require('express')
const supabase = require('../../../db/supabase');
const router = express.Router();
const { authLimiter } = require('../../../middlewares/limit');
const crypto = require('crypto');

// Seller login route 
// POST /api/seller/login
router.post('/seller/login', authLimiter, async (req, res) => {
    try {
        // Safely handle cases where req.body is undefined
        const { email, password } = req.body;

        // Verify if inpuits are provided
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required.' });
        }

        // Check if email exist
        const { data: seller, error: sellerError } = await supabase
        .from('users')
        .select('email')
        .eq('email', email)
        .single();

        if (sellerError || !seller) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        // Sign in the seller
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
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
            sameSite: 'lax',
            maxAge: data.session.expires_in * 1000,
            path: '/'
        })
        
        if (data.session.refresh_token) {
            res.cookie("refresh_token", data.session.refresh_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 3600000,
                path: '/'
            });
        }
        const response = {
            message: "Login successfully",
            user: data.user,
        }

        return res.status(200).json(response);

    } catch (error) {
        console.log("Login request error:", error.message);
        
        return res.status(500).json({ message: 'Internal server error.' });
    }
})

const generateRandomName = (length = 8) => {
    return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map(b => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62])
    .join('');
}

// Seller sign up route
// POST /api/seller/signup
router.post('/seller/signup', authLimiter, async (req, res) => {
    try {
        const { first_name, last_name, email, password } = req.body || {};

        // Verify if inputs are provided
        if (!first_name || !last_name || !email || !password) {
            return res.status(400).json({ message: 'All fields are required.' });
        }

        // See if email already exists
        const { data: existingUser, error: existingUserError } = await supabase
        .from('users')
        .select('email')
        .eq('email', email)
        .single();
        if (existingUser && !existingUserError) {
            return res.status(409).json({ message: 'Invalid credentials.' });
        }

        // Create new user
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
        })
        
        if (error) {
            return res.status(400).json({ message: 'Error creating user.' });
        }

        // Insert seller details into 'users' table 
        const { error: userError } = await supabase
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
            console.log("Error inserting user details:", userError.message);
            return res.status(500).json({ message: 'Error creating user.' });
        }

        // Add the user to sellers, shops, and balances tables
        const { data: sellerData, error: sellerError } = await supabase
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
            console.log("Error inserting into sellers table:", sellerError.message);
            return res.status(500).json({ message: 'Error creating user.' });
        }
        const { error: shopError } = await supabase
        .from('shops')
        .insert({ 
            seller_id: sellerData.id,
            is_live: false,
            name: `${generateRandomName()}'s shop`,
        })
        .select()
        .single();
        if (shopError) {
            console.log("Error inserting into shops table:", shopError.message);
            return res.status(500).json({ message: 'Error creating user.' });
        }
        const { error: balanceError } = await supabase
        .from('balances')
        .insert({ seller_id: sellerData.id })
        .select()
        .single();

        if (balanceError) {
            console.log("Error inserting into balances table:", balanceError.message);
            return res.status(500).json({ message: 'Error creating user.' });
        }

        const response = {
            message: "User created successfully. Please verify your email before logging in.",
            user: data.user,
        }

        return res.status(201).json(response);
    } catch (error) {
        console.log("Sign up request error:", error.message);
        return res.status(500).json({ message: 'Internal server error.', details: error.message });
    }
})


module.exports = router;