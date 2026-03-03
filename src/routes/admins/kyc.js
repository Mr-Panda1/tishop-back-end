const express = require('express');
const { supabase } = require('../../db/supabase');
const router = express.Router();
const { authenticateAdmin, requireRole } = require('../../middlewares/adminAuthMiddleware');
const { decryptFile } = require('../../utils/encryption');
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Get all by filter KYC requests
// GET /api/admin/kyc?status=pending&limit=20&offset=0
router.get('/admin/kyc',authenticateAdmin, async (req, res) => {
    try {
        const { status, limit = 20, offset = 0 } = req.query;
        const parsedLimit = Number.parseInt(limit, 10);
        const parsedOffset = Number.parseInt(offset, 10);
        const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 20) : 20;
        const safeOffset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

        // Build query for kyc_documents with seller info and files
        let query = supabase
            .from('kyc_documents')
            .select(`
                *,
                sellers(
                    id,
                    first_name,
                    last_name,
                    email,
                    phone,
                    is_verified,
                    verification_status
                )
            `, { count: 'exact' })
            .order('submitted_at', { ascending: false });

        // Filter by status if provided
        if (status && ['pending', 'approved', 'rejected'].includes(status)) {
            query = query.eq('status', status);
        }

        // Pagination
        query = query.range(safeOffset, safeOffset + safeLimit - 1);

        const { data: kycDocuments, error, count } = await query;

        if (error) {
            console.error('Error fetching KYC documents:', error);
            return res.status(500).json({ 
                message: 'Error retrieving KYC documents',
                error: error.message 
            });
        }

        const kycDocumentIds = (kycDocuments || []).map((doc) => doc.id);
        let kycFilesByDocumentId = {};

        if (kycDocumentIds.length > 0) {
            const { data: kycFiles, error: kycFilesError } = await supabase
                .from('kyc_files')
                .select(`
                    id,
                    kyc_document_id,
                    file_type,
                    id_front_url,
                    id_back_url,
                    selfie_url,
                    id_front_iv,
                    id_front_auth_tag,
                    id_back_iv,
                    id_back_auth_tag,
                    selfie_iv,
                    selfie_auth_tag,
                    uploaded_at
                `)
                .in('kyc_document_id', kycDocumentIds);

            if (kycFilesError) {
                console.error('Error fetching KYC files:', kycFilesError);
                return res.status(500).json({
                    message: 'Error retrieving KYC file metadata',
                    error: kycFilesError.message
                });
            }

            kycFilesByDocumentId = (kycFiles || []).reduce((acc, file) => {
                if (!acc[file.kyc_document_id]) {
                    acc[file.kyc_document_id] = [];
                }
                acc[file.kyc_document_id].push(file);
                return acc;
            }, {});
        }

        const createSignedUrl = async (filePath) => {
            if (!filePath) return null;

            const { data, error } = await supabase.storage
                .from('kyc_documents')
                .createSignedUrl(filePath, 60 * 30);

            if (error) {
                console.error('Error creating signed URL:', { filePath, error });
                return null;
            }

            return data?.signedUrl || null;
        };

        // Restructure to use original property names
        const restructured = await Promise.all(kycDocuments.map(async (doc) => {
            // Group kyc_files by file_type to reconstruct the expected format
            const filesByType = {};
            const documentFiles = kycFilesByDocumentId[doc.id] || [];
            documentFiles.forEach(file => {
                filesByType[file.file_type] = file;
            });

            const idFrontPath = filesByType.id_front?.id_front_url || null;
            const idBackPath = filesByType.id_back?.id_back_url || null;
            const selfiePath = filesByType.selfie?.selfie_url || null;

            const [idFrontSignedUrl, idBackSignedUrl, selfieSignedUrl] = await Promise.all([
                createSignedUrl(idFrontPath),
                createSignedUrl(idBackPath),
                createSignedUrl(selfiePath)
            ]);

            // Create a single file object with all URLs (expected by frontend)
            const singleFileObj = {
                id: doc.id,
                id_front_url: idFrontSignedUrl,
                id_back_url: idBackSignedUrl,
                selfie_url: selfieSignedUrl,
                id_front_path: idFrontPath,
                id_back_path: idBackPath,
                selfie_path: selfiePath,
                id_front_signed_url: idFrontSignedUrl,
                id_back_signed_url: idBackSignedUrl,
                selfie_signed_url: selfieSignedUrl,
                id_front_iv: filesByType.id_front?.id_front_iv || null,
                id_front_auth_tag: filesByType.id_front?.id_front_auth_tag || null,
                id_back_iv: filesByType.id_back?.id_back_iv || null,
                id_back_auth_tag: filesByType.id_back?.id_back_auth_tag || null,
                selfie_iv: filesByType.selfie?.selfie_iv || null,
                selfie_auth_tag: filesByType.selfie?.selfie_auth_tag || null,
                uploaded_at: doc.kyc_files?.[0]?.uploaded_at || null
            };

            return {
                ...doc,
                seller: doc.sellers,
                files: documentFiles.length > 0 ? [singleFileObj] : []
            };
        }));

        return res.status(200)
            .set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
            .json({ 
                success: true,
                count: restructured.length,
                total: count,
                pagination: {
                    limit: safeLimit,
                    offset: safeOffset,
                    total: count
                },
                data: restructured 
            });

    } catch (error) {
        console.error("Error in KYC fetch:", error.message);
        return res.status(500).json({ message: 'An error occurred while fetching KYC documents' });
    }
})

// GET /admin/kyc/files/:fileId/:fileType - Decrypt and serve KYC file
router.get('/admin/kyc/files/:kycDocId/:fileType', 
    authenticateAdmin,
    requireRole(['CEO', 'Manager', 'Admin', 'Moderator']),
    async (req, res) => {
        try {
            const { kycDocId, fileType } = req.params;

            // Validate file type
            if (!['id_front', 'id_back', 'selfie'].includes(fileType)) {
                return res.status(400).json({ message: 'Invalid file type' });
            }

            console.log('Querying kyc_files:', { kycDocId, fileType });

            // Get file metadata from kyc_files by file_type
            const { data: fileData, error: fileError } = await supabase
                .from('kyc_files')
                .select('*')
                .eq('kyc_document_id', kycDocId)
                .eq('file_type', fileType)
                .single();

            console.log('Query result:', { fileData, fileError });

            if (fileError || !fileData) {
                console.error('File fetch error:', fileError);
                return res.status(404).json({ message: 'File record not found' });
            }

            const filePath = fileData[`${fileType}_url`];
            const iv = fileData[`${fileType}_iv`];
            const authTag = fileData[`${fileType}_auth_tag`];

            if (!filePath) {
                return res.status(404).json({ message: 'File not found' });
            }

            // Download encrypted file from Supabase storage
            const { data: encryptedData, error: downloadError } = await supabase.storage
                .from('kyc_documents')
                .download(filePath);

            if (downloadError) {
                console.error('Download error:', downloadError);
                return res.status(500).json({ message: 'Error downloading file' });
            }

            // Convert blob to buffer
            const encryptedBuffer = Buffer.from(await encryptedData.arrayBuffer());

            // Decrypt the file
            const decryptedBuffer = decryptFile(encryptedBuffer, iv, authTag);

            // Send decrypted image
            res.set('Content-Type', 'image/webp');
            res.set('Content-Disposition', `inline; filename="${fileType}.webp"`);
            res.send(decryptedBuffer);

        } catch (error) {
            console.error('Error serving KYC file:', error);
            return res.status(500).json({ message: 'Error decrypting file' });
        }
    }
);


// Only CEO and Manager can approve KYC
router.put('/admin/kyc/:id/approve', 
    authenticateAdmin, 
    requireRole(['CEO', 'Manager', 'Admin']), 
    async (req, res) => {
        try {
            const { id } = req.params;

            if (!UUID_REGEX.test(id)) {
                return res.status(400).json({
                    success: false,
                    code: 'invalid_id',
                    message: 'Invalid KYC document id format.'
                });
            }

            const { data: kycRecord, error: kycFetchError } = await supabase
                .from('kyc_documents')
                .select('id, seller_id, status, submitted_at, reviewed_at, rejection_reason')
                .eq('id', id)
                .single();

            if (kycFetchError || !kycRecord) {
                return res.status(404).json({
                    success: false,
                    code: 'not_found',
                    message: 'KYC document not found.'
                });
            }

            if (kycRecord.status !== 'pending') {
                return res.status(409).json({
                    success: false,
                    code: 'already_reviewed',
                    message: 'KYC document has already been reviewed.',
                    current_status: kycRecord.status
                });
            }

            const reviewedAt = new Date().toISOString();

            const { data: approvedKyc, error: approveKycError } = await supabase
                .from('kyc_documents')
                .update({
                    status: 'approved',
                    reviewed_at: reviewedAt,
                    rejection_reason: null
                })
                .eq('id', id)
                .select('id, seller_id, status, submitted_at, reviewed_at, rejection_reason')
                .single();

            if (approveKycError || !approvedKyc) {
                console.error('Error approving KYC document:', approveKycError);
                return res.status(500).json({
                    success: false,
                    code: 'approve_failed',
                    message: 'Failed to approve KYC document.'
                });
            }

            const { data: updatedSeller, error: sellerUpdateError } = await supabase
                .from('sellers')
                .update({
                    is_verified: true,
                    verification_status: 'approved',
                    updated_at: reviewedAt
                })
                .eq('id', approvedKyc.seller_id)
                .select('id, is_verified, verification_status, updated_at')
                .single();

            if (sellerUpdateError || !updatedSeller) {
                console.error('Error updating seller verification status:', sellerUpdateError);

                await supabase
                    .from('kyc_documents')
                    .update({
                        status: 'pending',
                        reviewed_at: null
                    })
                    .eq('id', id);

                return res.status(500).json({
                    success: false,
                    code: 'seller_update_failed',
                    message: 'KYC approval failed while updating seller verification status.'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'KYC approved successfully.',
                kyc: approvedKyc,
                seller: updatedSeller,
                reviewed_by: {
                    id: req.admin.id,
                    role: req.admin.role
                },
                timestamp: reviewedAt
            });
        } catch (error) {
            console.error('Error approving KYC document:', error.message);
            return res.status(500).json({
                success: false,
                message: 'An error occurred while approving the KYC document.'
            });
        }
    }
);

// Reject KYC document
router.put('/admin/kyc/:id/reject', 
    authenticateAdmin, 
    requireRole(['CEO', 'Manager', 'Admin']), 
    async (req, res) => {
        try {
            const { id } = req.params;
            const { rejection_reason } = req.body;

            if (!UUID_REGEX.test(id)) {
                return res.status(400).json({
                    success: false,
                    code: 'invalid_id',
                    message: 'Invalid KYC document id format.'
                });
            }

            if (!rejection_reason || !rejection_reason.trim()) {
                return res.status(400).json({
                    success: false,
                    code: 'missing_reason',
                    message: 'Rejection reason is required.'
                });
            }

            const { data: kycRecord, error: kycFetchError } = await supabase
                .from('kyc_documents')
                .select('id, seller_id, status, submitted_at, reviewed_at, rejection_reason')
                .eq('id', id)
                .single();

            if (kycFetchError || !kycRecord) {
                return res.status(404).json({
                    success: false,
                    code: 'not_found',
                    message: 'KYC document not found.'
                });
            }

            if (kycRecord.status !== 'pending') {
                return res.status(409).json({
                    success: false,
                    code: 'already_reviewed',
                    message: 'KYC document has already been reviewed.',
                    current_status: kycRecord.status
                });
            }

            const reviewedAt = new Date().toISOString();

            const { data: rejectedKyc, error: rejectKycError } = await supabase
                .from('kyc_documents')
                .update({
                    status: 'rejected',
                    reviewed_at: reviewedAt,
                    rejection_reason: rejection_reason.trim()
                })
                .eq('id', id)
                .select('id, seller_id, status, submitted_at, reviewed_at, rejection_reason')
                .single();

            if (rejectKycError || !rejectedKyc) {
                console.error('Error rejecting KYC document:', rejectKycError);
                return res.status(500).json({
                    success: false,
                    code: 'reject_failed',
                    message: 'Failed to reject KYC document.'
                });
            }

            const { data: updatedSeller, error: sellerUpdateError } = await supabase
                .from('sellers')
                .update({
                    is_verified: false,
                    verification_status: 'rejected',
                    updated_at: reviewedAt
                })
                .eq('id', rejectedKyc.seller_id)
                .select('id, is_verified, verification_status, updated_at')
                .single();

            if (sellerUpdateError || !updatedSeller) {
                console.error('Error updating seller verification status:', sellerUpdateError);
            }

            return res.status(200).json({
                success: true,
                message: 'KYC rejected successfully.',
                kyc: rejectedKyc,
                seller: updatedSeller,
                reviewed_by: {
                    id: req.admin.id,
                    role: req.admin.role
                },
                timestamp: reviewedAt
            });
        } catch (error) {
            console.error('Error rejecting KYC document:', error.message);
            return res.status(500).json({
                success: false,
                message: 'An error occurred while rejecting the KYC document.'
            });
        }
    }
);

// Only CEO can create new admins
router.post('/admin/admins', 
    authenticateAdmin, 
    requireRole(['CEO']), 
    async (req, res) => {
        try {
            
        } catch (error) {
            
        }
    }
);

module.exports = router;