const express = require('express');
const router = express.Router();
const authenticateUser = require('../../../middlewares/authMiddleware');
const { supabase } = require('../../../db/supabase');
const upload = require('../../../middlewares/uploadMiddleware');
const sharp = require('sharp');
const { sellerStoreLimiter } = require('../../../middlewares/limit');

const BUCKET_NAME = 'sellers_public';
const LOGO_SIZE = 400;
const BANNER_WIDTH = 1920;
const BANNER_HEIGHT = 400;
const IMAGE_QUALITY = 85;

// PUT /sellers/update-shop
router.put('/update-shop',
    authenticateUser,
    sellerStoreLimiter,
    upload.fields([
        { name: 'logo', maxCount: 1 },
        { name: 'banner', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const user = req.user;
            const { name, description } = req.body;

            // Validate required fields
            if (!name?.trim() || !description?.trim()) {
                return res.status(400).json({ message: 'Le nom et la description sont requis' });
            }

            // Ensure seller exists in sellers table
            const { data: sellerRow, error: sellerFetchError } = await supabase
                .from('sellers')
                .select('id')
                .eq('user_id', user.id)
                .maybeSingle();

            if (sellerFetchError) {
                console.error('Error checking seller:', sellerFetchError);
                return res.status(500).json({ message: 'Error verifying seller record' });
            }

            if (!sellerRow) {
                return res.status(400).json({ message: 'Le profil du vendeur n\'a pas été trouvé. Complétez d\'abord l\'intégration du vendeur' });
            }

            // Fetch existing shop first
            const { data: existingShop, error: shopFetchError } = await supabase
                .from('shops')
                .select('id, logo_url, banner_url')
                .eq('seller_id', sellerRow.id)
                .maybeSingle();

            if (shopFetchError) {
                console.error('Error fetching shop:', shopFetchError);
                return res.status(500).json({ message: 'Error verifying shop record' });
            }

            const files = req.files || {};
            const logoFile = files.logo?.[0];
            const bannerFile = files.banner?.[0];

            // Logo is required only for new shops
            if (!existingShop && !logoFile) {
                return res.status(400).json({ message: 'Le logo est requis lors de la création d\'une boutique' });
            }

            // Process and upload logo if provided
            let logoPublicUrl = existingShop?.logo_url || null;
            if (logoFile) {
                try {
                    // Convert logo to WebP format and resize
                    const logoBuffer = await sharp(logoFile.buffer)
                        .resize(LOGO_SIZE, LOGO_SIZE, {
                            fit: 'cover',
                            position: 'center'
                        })
                        .webp({ quality: IMAGE_QUALITY })
                        .toBuffer();

                    const logoPath = `${user.id}/shop/logo.webp`;
                    const { error: logoError } = await supabase.storage
                        .from(BUCKET_NAME)
                        .upload(logoPath, logoBuffer, {
                            contentType: 'image/webp',
                            upsert: true,
                        });

                    if (logoError) {
                        console.error('Error uploading logo:', logoError);
                        return res.status(500).json({ message: 'Error uploading logo' });
                    }

                    const { data: logoPub } = supabase.storage
                        .from(BUCKET_NAME)
                        .getPublicUrl(logoPath);
                    logoPublicUrl = logoPub.publicUrl;
                } catch (imageError) {
                    console.error('Error processing logo:', imageError);
                    return res.status(500).json({ message: 'Error processing logo image' });
                }
            }

            // Process and upload banner if provided (optional)
            let bannerPublicUrl = existingShop?.banner_url || null;
            if (bannerFile) {
                try {
                    // Convert banner to WebP format and resize
                    const bannerBuffer = await sharp(bannerFile.buffer)
                        .resize(BANNER_WIDTH, BANNER_HEIGHT, {
                            fit: 'cover',
                            position: 'center'
                        })
                        .webp({ quality: IMAGE_QUALITY })
                        .toBuffer();

                    const bannerPath = `${user.id}/shop/banner.webp`;
                    const { error: bannerError } = await supabase.storage
                        .from(BUCKET_NAME)
                        .upload(bannerPath, bannerBuffer, {
                            contentType: 'image/webp',
                            upsert: true,
                        });

                    if (bannerError) {
                        console.error('Error uploading banner:', bannerError);
                        return res.status(500).json({ message: 'Error uploading banner' });
                    }

                    const { data: bannerPub } = supabase.storage
                        .from(BUCKET_NAME)
                        .getPublicUrl(bannerPath);
                    bannerPublicUrl = bannerPub.publicUrl;
                } catch (imageError) {
                    console.error('Error processing banner:', imageError);
                    return res.status(500).json({ message: 'Error processing banner image' });
                }
            }


            // Prepare shop data
            const shopData = {
                name: name.trim(),
                description: description.trim(),
                logo_url: logoPublicUrl,
                banner_url: bannerPublicUrl,
                updated_at: new Date().toISOString(),
            };

            if (existingShop) {
                // Update existing shop
                const { error: updateError } = await supabase
                    .from('shops')
                    .update(shopData)
                    .eq('id', existingShop.id);

                if (updateError) {
                    console.error('Error updating shop:', updateError);
                    return res.status(500).json({ message: 'Error updating shop' });
                }

                return res.status(200).json({ 
                    message: 'Shop updated successfully',
                    shop: { id: existingShop.id, ...shopData }
                });
            } else {
                // Create new shop
                const { data: newShop, error: insertError } = await supabase
                    .from('shops')
                    .insert([{
                        seller_id: sellerRow.id,
                        ...shopData
                    }])
                    .select()
                    .single();

                if (insertError) {
                    console.error('Error creating shop:', insertError);
                    return res.status(500).json({ message: 'Error creating shop' });
                }

                return res.status(201).json({ 
                    message: 'Shop created successfully',
                    shop: newShop
                });
            }
        } catch (error) {
            console.error('Error managing shop:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    });


// POST get shop
router.get('/get-shop', sellerStoreLimiter, authenticateUser, async (req, res) => {
  try {
    const user = req.user;

    // Find seller by user_id
    const { data: sellerRow, error: sellerFetchError } = await supabase
    .from('sellers')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

    if (sellerFetchError) {
        console.error('Error fetching seller for getting shop:', sellerFetchError);
        return res.status(500).json({message: "Error getting seller data."})
    }
    if (!sellerRow) {
        return res.status(400).json({message: "Seller profile not found. Configure your shop first."})
    }

    // Get the shop by seller_id
    const { data: shopData, error: shopError } = await supabase
    .from('shops')
    .select('*')
    .eq('seller_id', sellerRow.id)
    .maybeSingle();

    if (shopError) {
        console.error('Error fetching shop for getting shop:', shopError);
        return res.status(400).json({message: "Error getting shop data."})
    }

    if (!shopData) {
        return res.status(400).json({message: "Shop not found. Configure your shop first."})
    }

    return res.status(200).json({ shopData: shopData });
  } catch (error) {
    console.error(`Error fetching shop for user ${user.id}:`, error);
    return res.status(500).json({ message: 'Internal server error' });
  }
})

// POST add location
router.post('/add-location',sellerStoreLimiter, authenticateUser, async (req, res) => {
    try {
        const { department, arrondissement, commune } = req.body;
        const user = req.user;

        // validating
        if (!department || !arrondissement || !commune) {
            return res.status(400).json({message: "Missing fields. All fields are required"})
        }

        // Find seller by user_id
        const { data: sellerRow, error: sellerFetchError } = await supabase
        .from('sellers')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

        if (sellerFetchError) {
            console.error('Error fetching seller for location:', sellerFetchError);
            return res.status(500).json({message: "Error getting seller data."})
        }

        if (!sellerRow) {
            return res.status(400).json({message: "Seller profile not found. Configure your shop first."})
        }

        // Get the shop_id using seller.id
        const { data: shopData, error: shopError } = await supabase
        .from('shops')
        .select('id')
        .eq('seller_id', sellerRow.id)
        .maybeSingle();

        if (shopError) {
            console.error('Error fetching shop for location:', shopError);
            return res.status(400).json({message: "Error getting shop data. Configure your shop first."})
        }

        if (!shopData) {
            return res.status(400).json({message: "Shop not found. Configure your shop first."})
        }
        // Add them in the db 
        const { data: insertedLocation, error } = await supabase
        .from('shop_locations')
        .insert({
            shop_id: shopData.id,
            department_id: department,
            arrondissement_id: arrondissement,
            commune_id: commune
        })
        .select('id')
        .single();

        if (error) {
            return res.status(400).json({message: "Error while adding shop location. Please try again later"})
        }

        return res.status(201).json({
          location: {
            id: insertedLocation.id,
            department: department,
            arrondissement: arrondissement,
            commune: commune
          },
          message: "Location added successfully"
        })
    } catch (error) {
        console.error("Error while adding shop location:", error);
        return res.status(500).json({message: "Internal server error"})
    }
})

// GET locations
router.get('/get-locations',sellerStoreLimiter, authenticateUser, async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Find seller by user_id
    const { data: sellerRow, error: sellerFetchError } = await supabase
      .from('sellers')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (sellerFetchError) {
      console.error('Error fetching seller for locations:', sellerFetchError);
      return res.status(500).json({ message: 'Error getting seller data.' });
    }

    if (!sellerRow) {
      return res.status(400).json({ message: 'Seller profile not found. Configure your shop first.' });
    }

    // Get the shop by seller_id
    const { data: shopData, error: shopError } = await supabase
      .from('shops')
      .select('id')
      .eq('seller_id', sellerRow.id)
      .maybeSingle();

    if (shopError) {
      console.error('Error fetching shop for locations:', shopError);
      return res.status(400).json({ message: 'Error getting shop data.' });
    }

    if (!shopData) {
      return res.status(400).json({ message: 'Shop not found. Configure your shop first.' });
    }

    // Fetch locations
    const { data: locations, error: locationsError } = await supabase
      .from('shop_locations')
      .select('*')
      .eq('shop_id', shopData.id);

    if (locationsError) {
      console.error('Error fetching shop locations:', locationsError);
      return res.status(500).json({ message: 'Error getting shop locations.' });
    }

    // Format locations (TEXT fields already contain names)
    const formattedLocations = locations.map(loc => ({
      id: loc.id,
      department: loc.department_id,
      arrondissement: loc.arrondissement_id,
      commune: loc.commune_id
    }));

    return res.status(200).json({ locations: formattedLocations });
  } catch (error) {
    console.error('Error geting shop locations:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
})


// Delete location by id
router.delete('/delete-location/:locationId', sellerStoreLimiter, authenticateUser, async (req, res) => {
  try {
    const user = req.user;
    const { locationId } = req.params;

    if (!locationId) {
      return res.status(400).json({ message: 'Location ID is required.' });
    }

    // Find seller by user_id
    const { data: sellerRow, error: sellerFetchError } = await supabase
      .from('sellers')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (sellerFetchError) {
        console.error('Error fetching seller for location deletion:', sellerFetchError);
        return res.status(500).json({message: "Error getting seller data."})
    }
    if (!sellerRow) {
        return res.status(400).json({message: "Seller profile not found. Configure your shop first."})
    }

    // Get the shop_id using seller.id
    const { data: shopData, error: shopError } = await supabase
    .from('shops')
    .select('id')
    .eq('seller_id', sellerRow.id)
    .maybeSingle();
    if (shopError) {
        console.error('Error fetching shop for location deletion:', shopError);
        return res.status(400).json({message: "Error getting shop data. Configure your shop first."})
    }
    if (!shopData) {
        return res.status(400).json({message: "Shop not found. Configure your shop first."})
    }

    // Delete location by its ID (verify it belongs to this shop)
    const { error: deleteError } = await supabase
      .from('shop_locations')
      .delete()
      .eq('id', locationId)
      .eq('shop_id', shopData.id);
    
      if (deleteError) {
        console.error('Error deleting shop location:', deleteError);
        return res.status(500).json({ message: 'Error deleting shop location.' });
    }

    return res.status(200).json({ message: 'Location deleted successfully.' });
  } catch (error) {
    console.error("Error deleting location:", error);
    return res.status(500).json({ message: 'Internal server error' });
  }
})







// Change shop status to true/false
// Accept status changes via PATCH with JSON or FormData
router.patch('/change-shop-status', sellerStoreLimiter, authenticateUser, upload.none(), async (req, res) => {
  try {
    const user = req.user;

    // Support boolean or string ('true'/'false') and FormData
    let { is_live } = req.body || {};
    if (typeof is_live === 'string') {
      is_live = is_live.toLowerCase() === 'true';
    }

    if (typeof is_live !== 'boolean') {
      return res.status(400).json({ message: 'Invalid status value.' });
    }

    // Find seller by user_id
    const { data: sellerRow, error: sellerFetchError } = await supabase
    .from('sellers')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

    if (sellerFetchError) {
        console.error('Error fetching seller for shop status change:', sellerFetchError);
        return res.status(500).json({message: "Error getting seller data."})
    }
    if (!sellerRow) {
        return res.status(400).json({message: "Seller profile not found. Configure your shop first."})
    }

    // Get the shop_id using seller.id
    const { data: shopData, error: shopError } = await supabase
    .from('shops')
    .select('id, is_live')
    .eq('seller_id', sellerRow.id)
    .maybeSingle();

    if (shopError) {
        console.error('Error fetching shop for status change:', shopError);
        return res.status(400).json({message: "Error getting shop data. Configure your shop first."})
    }
    if (!shopData) {
        return res.status(400).json({message: "Shop not found. Configure your shop first."})
    }

    // Check KYC status for any is_live change request
    const { data: kycData, error: kycError } = await supabase      
      .from('kyc_documents')
      .select('status')
      .eq('seller_id', sellerRow.id)
      .maybeSingle();
      
    if (kycError) {
      console.error('Error fetching KYC data for status change:', kycError);
      return res.status(500).json({ message: 'Error verifying KYC status.' });
    }

    // Only allow is_live = true if KYC status is approved
    const hasApprovedKYC = kycData && kycData.status === 'approved';
    
    if (is_live && !hasApprovedKYC) {
      return res.status(400).json({ message: 'KYC approval is required to go live. Please complete KYC verification first.' });
    }

    // If KYC is not approved, force is_live to false regardless of request
    const finalLiveStatus = hasApprovedKYC ? is_live : false;

    // Update status
    const { error: updateError } = await supabase
    .from('shops')
    .update({ is_live: finalLiveStatus })
    .eq('id', shopData.id); 
    
    if (updateError) {
        console.error('Error updating shop status:', updateError);
        return res.status(500).json({ message: 'Error updating shop status.' });
    }

    return res.status(200).json({ 
      is_live: finalLiveStatus,
      message: finalLiveStatus !== is_live 
        ? 'Shop status set to offline due to KYC status.' 
        : 'Shop status updated successfully.' 
    });
  } catch (error) {
    console.error("Error changing shop status:", error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST delivery
router.post('/add-delivery', sellerStoreLimiter, authenticateUser, async (req, res) => {
  try {
    const user = req.user;

    const { commune_id, price, estimated_days } = req.body;
    if (!commune_id || !price || !estimated_days) {
      return res.status(400).json({ message: 'Missing required fields.' });
    }

    // Find seller by user_id
    const { data: sellerRow, error: sellerFetchError } = await supabase
    .from('sellers')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();
    if (sellerFetchError) {
        console.error('Error fetching seller for adding delivery option:', sellerFetchError);
        return res.status(500).json({message: "Error getting seller data."})
    }
    if (!sellerRow) {
        return res.status(400).json({message: "Seller profile not found. Configure your shop first."})
    }
    // Get the shop_id using seller.id
    const { data: shopData, error: shopError } = await supabase
    .from('shops')
    .select('id')
    .eq('seller_id', sellerRow.id)
    .maybeSingle();
    if (shopError) {
        console.error('Error fetching shop for adding delivery option:', shopError);
        return res.status(400).json({message: "Error getting shop data. Configure your shop first."})
    }
    if (!shopData) {
        return res.status(400).json({message: "Shop not found. Configure your shop first."})
    }
    // Insert delivery option
    const { data: insertDelivery, error: insertEror } = await supabase 
    .from('delivery_options')
    .insert({
      shop_id: shopData.id,
      commune_id,
      price,
      estimated_days,
      is_active: true
    })
    .select('*')
    .single();

    if (insertEror) {
      console.error('Error inserting delivery option:', insertEror);
      return res.status(500).json({ message: 'Error adding delivery option.' });
    }
    return res.status(201).json({
      deliveryOption: insertDelivery,
      message: 'Delivery option added successfully.'
    });
  } catch (error) {
    console.error("Error adding delivery option");
    return res.status(500).json({ message: 'Internal server error' });
  }
})

// GET locations
router.get('/get-delivery', sellerStoreLimiter, authenticateUser, async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Find seller by user_id
    const { data: sellerRow, error: sellerFetchError } = await supabase
      .from('sellers')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (sellerFetchError) {
      console.error('Error fetching seller for locations:', sellerFetchError);
      return res.status(500).json({ message: 'Error getting seller data.' });
    }

    if (!sellerRow) {
      return res.status(400).json({ message: 'Seller profile not found. Configure your shop first.' });
    }

    // Get the shop by seller_id
    const { data: shopData, error: shopError } = await supabase
      .from('shops')
      .select('id')
      .eq('seller_id', sellerRow.id)
      .maybeSingle();

    if (shopError) {
      console.error('Error fetching shop for locations:', shopError);
      return res.status(400).json({ message: 'Error getting shop data.' });
    }

    if (!shopData) {
      return res.status(400).json({ message: 'Shop not found. Configure your shop first.' });
    }

    // Fetch delivery options
    const { data: deliveryOption, error: deliveryError } = await supabase
    .from('delivery_options')
    .select('*')
    .eq('shop_id', shopData.id);

    if (deliveryError) {
      console.error('Error fetching delivery options:', deliveryError);
      return res.status(500).json({ message: 'Error getting delivery options.' });
    }

    // Format delivery options
    const formattedDelivery = deliveryOption.map(option => ({
      id: option.id,
      commune_id: option.commune_id,
      price: option.price,
      estimated_days: option.estimated_days,
      is_active: option.is_active
    }));

    return res.status(200).json({ delivery_options: formattedDelivery });
  } catch (error) {
    console.error('Error geting shop locations:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
})


// Delete delivery option by id
// Delete location by id
router.delete('/delete-delivery/:deliveryOptionId', sellerStoreLimiter, authenticateUser, async (req, res) => {
  try {
    const user = req.user;
    const { deliveryOptionId } = req.params;

    if (!deliveryOptionId) {
      return res.status(400).json({ message: 'Delivery Option is required.' });
    }

    // Find seller by user_id
    const { data: sellerRow, error: sellerFetchError } = await supabase
      .from('sellers')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (sellerFetchError) {
        console.error('Error fetching seller for location deletion:', sellerFetchError);
        return res.status(500).json({message: "Error getting seller data."})
    }
    if (!sellerRow) {
        return res.status(400).json({message: "Seller profile not found. Configure your shop first."})
    }

    // Get the shop_id using seller.id
    const { data: shopData, error: shopError } = await supabase
    .from('shops')
    .select('id')
    .eq('seller_id', sellerRow.id)
    .maybeSingle();
    if (shopError) {
        console.error('Error fetching shop for location deletion:', shopError);
        return res.status(400).json({message: "Error getting shop data. Configure your shop first."})
    }
    if (!shopData) {
        return res.status(400).json({message: "Shop not found. Configure your shop first."})
    }

    // Delete delivery option by its ID (verify it belongs to this shop)
    const { error: deleteError } = await supabase
      .from('delivery_options')
      .delete()
      .eq('id', deliveryOptionId)
      .eq('shop_id', shopData.id);
    
      if (deleteError) {
        console.error('Error deleting shop delivery option:', deleteError);
        return res.status(500).json({ message: 'Error deleting shop delivery option.' });
    }

    return res.status(200).json({ message: 'Delivery option deleted successfully.' });
  } catch (error) {
    console.error("Error deleting derlivery option:", error);
    return res.status(500).json({ message: 'Internal server error' });
  }
})


// POST Pick up
router.post('/add-pickup-point', sellerStoreLimiter, authenticateUser, async (req, res) => {
  try {
    const user = req.user;

    const { commune_id, quartier, landmark, instructions, phone, gps_coordinates } = req.body;
    if (!commune_id || !landmark || !instructions || !phone ) {
      return res.status(400).json({ message: 'Missing required fields.' });
    }

    // Find seller by user_id
    const { data: sellerRow, error: sellerFetchError } = await supabase
    .from('sellers')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();
    if (sellerFetchError) {
        console.error('Error fetching seller for adding delivery option:', sellerFetchError);
        return res.status(500).json({message: "Error getting seller data."})
    }
    if (!sellerRow) {
        return res.status(400).json({message: "Seller profile not found. Configure your shop first."})
    }
    // Get the shop_id using seller.id
    const { data: shopData, error: shopError } = await supabase
    .from('shops')
    .select('id')
    .eq('seller_id', sellerRow.id)
    .maybeSingle();
    if (shopError) {
        console.error('Error fetching shop for adding delivery option:', shopError);
        return res.status(400).json({message: "Error getting shop data. Configure your shop first."})
    }
    if (!shopData) {
        return res.status(400).json({message: "Shop not found. Configure your shop first."})
    }
    // Insert delivery option
    const { data: insertPickupOption, error: insertEror } = await supabase 
    .from('pickup_points')
    .insert({
      shop_id: shopData.id,
      commune_id,
      quartier,
      landmark,
      instructions,
      phone,
      gps_coordinates,
      is_active: true   
    })
    .select('*')
    .single();

    if (insertEror) {
      console.error('Error inserting pickup option:', insertEror);
      return res.status(500).json({ message: 'Error adding pickup option.' });
    }
    return res.status(201).json({
      pickupOption: insertPickupOption,
      message: 'Pickup option added successfully.'
    });
  } catch (error) {
    console.error("Error adding pickup option");
    return res.status(500).json({ message: 'Internal server error' });
  }
})

// GET pickup
router.get('/get-pickup-point', sellerStoreLimiter, authenticateUser, async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Find seller by user_id
    const { data: sellerRow, error: sellerFetchError } = await supabase
      .from('sellers')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (sellerFetchError) {
      console.error('Error fetching seller for locations:', sellerFetchError);
      return res.status(500).json({ message: 'Error getting seller data.' });
    }

    if (!sellerRow) {
      return res.status(400).json({ message: 'Seller profile not found. Configure your shop first.' });
    }

    // Get the shop by seller_id
    const { data: shopData, error: shopError } = await supabase
      .from('shops')
      .select('id')
      .eq('seller_id', sellerRow.id)
      .maybeSingle();

    if (shopError) {
      console.error('Error fetching shop for locations:', shopError);
      return res.status(400).json({ message: 'Error getting shop data.' });
    }

    if (!shopData) {
      return res.status(400).json({ message: 'Shop not found. Configure your shop first.' });
    }

    // Fetch pickup points
    const { data: pickupPoints, error:  pickupsPointsError} = await supabase
    .from('pickup_points')
    .select('*')
    .eq('shop_id', shopData.id);

    if (pickupsPointsError) {
      console.error('Error fetching pickup points:', pickupsPointsError);
      return res.status(500).json({ message: 'Error getting pickup points.' });
    }

    // Format pickup points
    const formattedPickupPoints = pickupPoints.map(option => ({
      id: option.id,
      commune_id: option.commune_id,
      quartier: option.quartier,
      landmark: option.landmark,
      instructions: option.instructions,
      phone: option.phone,
      gps_coordinates: option.gps_coordinates,
      is_active: option.is_active
    }));

    return res.status(200).json({ delivery_options: formattedPickupPoints });
  } catch (error) {
    console.error('Error geting shop locations:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
})

// Delete pickup point by id
router.delete('/delete-pickup-point/:pickupPointId', sellerStoreLimiter, authenticateUser, async (req, res) => {
  try {
    const user = req.user;
    const { pickupPointId } = req.params;

    if (!pickupPointId) {
      return res.status(400).json({ message: 'Pickup point is required.' });
    }

    // Find seller by user_id
    const { data: sellerRow, error: sellerFetchError } = await supabase
      .from('sellers')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (sellerFetchError) {
        console.error('Error fetching seller for location deletion:', sellerFetchError);
        return res.status(500).json({message: "Error getting seller data."})
    }
    if (!sellerRow) {
        return res.status(400).json({message: "Seller profile not found. Configure your shop first."})
    }

    // Get the shop_id using seller.id
    const { data: shopData, error: shopError } = await supabase
    .from('shops')
    .select('id')
    .eq('seller_id', sellerRow.id)
    .maybeSingle();
    if (shopError) {
        console.error('Error fetching shop for location deletion:', shopError);
        return res.status(400).json({message: "Error getting shop data. Configure your shop first."})
    }
    if (!shopData) {
        return res.status(400).json({message: "Shop not found. Configure your shop first."})
    }

    // Delete pickup point by its ID (verify it belongs to this shop)
    const { error: deleteError } = await supabase
      .from('pickup_points')
      .delete()
      .eq('id', pickupPointId)
      .eq('shop_id', shopData.id);
    
      if (deleteError) {
        console.error('Error deleting shop pickup point:', deleteError);
        return res.status(500).json({ message: 'Error deleting shop pickup point.' });
    }

    return res.status(200).json({ message: 'Pickup point deleted successfully.' });
  } catch (error) {
    console.error("Error deleting pickup point:", error);
    return res.status(500).json({ message: 'Internal server error' });
  }
})
module.exports = router;