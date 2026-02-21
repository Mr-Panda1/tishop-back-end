const express = require('express');
const router = express.Router();
const { supabase } = require('../../../db/supabase');

// Seller registration
// function to verify seller role and if it is seller then create a seller profile for them 
async function createSellersandShops() {
    const { data: users, error: usersError} = await supabase
    .from('users')
    .select('*')
    .eq('role', 'seller');

    if (usersError) {
        console.error("Error fetching users:", usersError);
        return;
    }

    console.log(`Found ${users.length} sellers.`);

    // create a seller profile for each selller
    for (const user of users) {
        const { data: existingSeller, error: existingSellerError } = await supabase
        .from('sellers')
        .select('*')
        .eq('user_id', user.id)
        .single();

        if (existingSellerError && existingSellerError.code !== 'PGRST116') {
            console.error(`Error checking existing seller for user ${user.id}:`, existingSellerError);
            continue;
        }

        // Create seller profile
            const { data: newSeller, error: newSellerError } = await supabase
            .from('sellers')
            .insert([{
                user_id: user.id,
                first_name: user.first_name,
                last_name: user.last_name,
                email: user.email,
                phone: null,
                is_verified: false,
                verification_status: 'pending',
            }])
            .select()
            .single();

            if (newSellerError) {
                console.error(`Error creating seller for user ${user.id}:`, newSellerError);
                continue;
            }
            console.log(`Created seller profile for user ${user.id}:`, newSeller);

            // create shop for the seller
    }
}

createSellersandShops();
