const express = require('express');
const router = express.Router();
const authenticateUser = require('../../../middlewares/authMiddleware');
const { supabase } = require('../../../db/supabase');
const upload = require('../../../middlewares/uploadMiddleware');
const sharp = require('sharp');
const { sellerKYCLimiter } = require('../../../middlewares/limit');

const BUCKET_NAME = 'kyc_documents';
const MAX_IMAGES = 3;
const IMAGE_WIDTH = 1200;
const IMAGE_QUALITY = 80;

// POST /sellers/kyc - Submit KYC documents
router.post('/submit-kyc', authenticateUser, sellerKYCLimiter, 
    upload.fields([
        { name: 'id_front_url', maxCount: 1 },
        { name: 'id_back_url', maxCount: 1 },
        { name: 'selfie_url', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const user = req.user;
            const { 
                first_name,
                last_name,
                phone,
                date_of_birth,
                commune_id,
                id_type,
                id_number,
                payout_method,
                payout_account_name,
                payout_account_number
             } = req.body

            //  Validate required fields
            if (!first_name?.trim() || !last_name?.trim() || !date_of_birth?.trim() || !commune_id?.trim() || !id_type?.trim() || !id_number?.trim() || !payout_method?.trim() || !payout_account_name?.trim() || !payout_account_number?.trim() || !phone?.trim()) {
                return res.status(400).json({ error: 'All fields are required' });
            }

            // Validate phone number format (509XXXXXXXX)
            const phoneRegex = /^\+?509\d{8}$/;
            if (!phoneRegex.test(phone)) {
                return res.status(400).json({ error: 'Invalid phone number format. Must start with 509' });
            }

            // Validate files uploaded
            if (!req.files?.id_front_url || !req.files?.selfie_url) {
                return res.status(400).json({ error: 'ID front and selfie images are required' });
            }

            // For non-passport IDs, id_back is required
            if (id_type !== 'passport' && !req.files?.id_back_url) {
                return res.status(400).json({ error: 'Back of ID is required for this document type' });
            }

            // Ensure sellers exist in sellers table
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
                return res.status(404).json({ message: 'Seller record not found' });
            }

            // Insert KYC record
            const { data: kycData, error: kycInsertError } = await supabase
                .from('kyc_documents')
                .insert({
                    seller_id: sellerRow.id,
                    first_name,
                    last_name,
                    phone,
                    date_of_birth,
                    commune_id,
                    id_type,
                    id_number,
                    payout_method,
                    payout_account_name,
                    payout_account_number,
                    status: 'pending',
                    submitted_at: new Date().toISOString()
                })
                .select()
                .single();

            if (kycInsertError) {
                console.error('Error inserting KYC record:', kycInsertError);
                return res.status(500).json({ message: 'Error submitting KYC information' });
            }

            const kycDocumentId = kycData.id;
            const uploadedUrls = {};
            const basePath = `${sellerRow.id}/${kycDocumentId}`;

            try {
                // Process and upload id_front
                if (req.files.id_front_url) {
                    const file = req.files.id_front_url[0];
                    const fileName = `${basePath}/id_front_${Date.now()}.webp`;
                    
                    const webpBuffer = await sharp(file.buffer)
                        .resize(IMAGE_WIDTH, IMAGE_WIDTH, { fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: IMAGE_QUALITY })
                        .toBuffer();

                    const { error: uploadError } = await supabase.storage
                        .from(BUCKET_NAME)
                        .upload(fileName, webpBuffer, { contentType: 'image/webp' });

                    if (uploadError) throw uploadError;

                    uploadedUrls.id_front_url = fileName;
                }

                // Process and upload id_back (if provided)
                if (req.files.id_back_url) {
                    const file = req.files.id_back_url[0];
                    const fileName = `${basePath}/id_back_${Date.now()}.webp`;
                    
                    const webpBuffer = await sharp(file.buffer)
                        .resize(IMAGE_WIDTH, IMAGE_WIDTH, { fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: IMAGE_QUALITY })
                        .toBuffer();

                    const { error: uploadError } = await supabase.storage
                        .from(BUCKET_NAME)
                        .upload(fileName, webpBuffer, { contentType: 'image/webp' });

                    if (uploadError) throw uploadError;

                    uploadedUrls.id_back_url = fileName;
                }

                // Process and upload selfie
                if (req.files.selfie_url) {
                    const file = req.files.selfie_url[0];
                    const fileName = `${basePath}/selfie_${Date.now()}.webp`;
                    
                    const webpBuffer = await sharp(file.buffer)
                        .resize(IMAGE_WIDTH, IMAGE_WIDTH, { fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: IMAGE_QUALITY })
                        .toBuffer();

                    const { error: uploadError } = await supabase.storage
                        .from(BUCKET_NAME)
                        .upload(fileName, webpBuffer, { contentType: 'image/webp' });

                    if (uploadError) throw uploadError;

                    uploadedUrls.selfie_url = fileName;
                }

                // Insert file URLs into kyc_files table
                const { error: filesInsertError } = await supabase
                    .from('kyc_files')
                    .insert({
                        kyc_document_id: kycDocumentId,
                        id_front_url: uploadedUrls.id_front_url,
                        id_back_url: uploadedUrls.id_back_url || null,
                        selfie_url: uploadedUrls.selfie_url,
                        uploaded_at: new Date().toISOString()
                    });

                if (filesInsertError) {
                    console.error('Error inserting file URLs:', filesInsertError);
                    return res.status(500).json({ message: 'Error saving file information' });
                }

                return res.status(201).json({ 
                    message: 'Documents KYC soumis avec succès',
                    kycDocumentId: kycDocumentId,
                    status: 'pending'
                });

            } catch (uploadError) {
                console.error('Error uploading files:', uploadError);
                return res.status(500).json({ message: 'Error uploading documents' });
            }

        } catch (error) {
            console.error('Error in KYC submission:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    }
 );

//  GET /sellers/kyc/status - Get current KYC status
router.get('/status', authenticateUser, async (req, res) => {
    try {
        const user = req.user;
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
            return res.status(404).json({ message: 'Seller record not found' });
        }
        const { data: kycData, error: kycFetchError } = await supabase
            .from('kyc_documents')
            .select('id, status, submitted_at, reviewed_at, rejection_reason')
            .eq('seller_id', sellerRow.id)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (kycFetchError) {
            console.error('Error fetching KYC status:', kycFetchError);
            return res.status(500).json({ message: 'Error fetching KYC status' });
        }
        if (!kycData) {
            return res.status(200).json({ status: 'not_submitted', message: 'Vos informations KYC ne sont pas soumises. Veuillez les soumettre pour commencer à vendre sur TiShop.'});
        }

        if (kycData.status === 'rejected') {
            return res.status(200).json({
                status: kycData.status,
                message: 'Votre soumission KYC a été rejetée. Veuillez examiner la raison du rejet et la soumettre à nouveau.',
                submitted_at: kycData.submitted_at,
                reviewed_at: kycData.reviewed_at,
                rejection_reason: kycData.rejection_reason || 'No reason provided'
            });
        }

        return res.status(200).json({
            status: kycData.status,
            message: kycData.status === 'pending' ? 'Votre soumission KYC est en cours d\'examen. Nous vous notifierons une fois qu\'une décision aura été prise.' : 'Votre soumission KYC est approuvée. Vous pouvez maintenant commencer à vendre sur TiShop.',
            submitted_at: kycData.submitted_at,
            reviewed_at: kycData.reviewed_at,
            rejection_reason: kycData.rejection_reason 
        });
    } catch (error) {}
});

module.exports = router;