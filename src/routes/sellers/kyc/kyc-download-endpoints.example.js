// Example: Download and decrypt KYC file endpoint
// Add this to your kyc.js router if you need to allow downloading KYC documents

const { decryptFile, hashFile } = require('../../../utils/encryption');

/**
 * GET /sellers/kyc/:kycId/download/:fileType
 * Download and decrypt KYC file (id_front, id_back, selfie)
 * 
 * Usage:
 * GET /sellers/kyc/12345/download/id_front
 * GET /sellers/kyc/12345/download/selfie
 */
router.get('/download/:kycId/:fileType', authenticateUser, async (req, res) => {
    try {
        const user = req.user;
        const { kycId, fileType } = req.params;
        
        // Validate fileType
        if (!['id_front', 'id_back', 'selfie'].includes(fileType)) {
            return res.status(400).json({ message: 'Type de fichier invalide' });
        }

        // Verify seller owns this KYC document
        const { data: sellerRow, error: sellerFetchError } = await supabase
            .from('sellers')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (sellerFetchError || !sellerRow) {
            return res.status(401).json({ message: 'Non autorisé' });
        }

        // Verify KYC belongs to seller
        const { data: kycData, error: kycFetchError } = await supabase
            .from('kyc_documents')
            .select('id, seller_id, status')
            .eq('id', kycId)
            .eq('seller_id', sellerRow.id)
            .maybeSingle();

        if (kycFetchError || !kycData) {
            return res.status(404).json({ message: 'Document KYC non trouvé' });
        }

        // Get file metadata from kyc_files table
        const { data: fileRecord, error: fileFetchError } = await supabase
            .from('kyc_files')
            .select(`${fileType}_url, ${fileType}_iv, ${fileType}_auth_tag, ${fileType}_hash`)
            .eq('kyc_document_id', kycId)
            .maybeSingle();

        if (fileFetchError || !fileRecord) {
            return res.status(404).json({ message: 'Fichier introuvable' });
        }

        const fileUrl = fileRecord[`${fileType}_url`];
        const fileIv = fileRecord[`${fileType}_iv`];
        const fileAuthTag = fileRecord[`${fileType}_auth_tag`];
        const fileHash = fileRecord[`${fileType}_hash`];

        if (!fileUrl || !fileIv || !fileAuthTag) {
            return res.status(404).json({ message: 'Métadonnées de fichier manquantes' });
        }

        // Download encrypted file from storage
        const { data: encryptedBuffer, error: downloadError } = await supabase
            .storage
            .from('kyc_documents')
            .download(fileUrl);

        if (downloadError) {
            console.error('Error downloading file:', downloadError);
            return res.status(500).json({ message: 'Erreur lors du téléchargement du fichier' });
        }

        // Decrypt the file
        const decryptedBuffer = decryptFile(
            Buffer.from(encryptedBuffer),
            fileIv,
            fileAuthTag
        );

        // Verify file integrity
        const calculatedHash = hashFile(decryptedBuffer);
        if (calculatedHash !== fileHash) {
            console.error('File integrity check failed');
            return res.status(500).json({ message: 'Erreur de vérification de l\'intégrité du fichier' });
        }

        // Send decrypted file
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Content-Disposition', `attachment; filename="${fileType}.webp"`);
        res.send(decryptedBuffer);

    } catch (error) {
        console.error('Error downloading file:', error);
        return res.status(500).json({ message: 'Erreur serveur interne' });
    }
});


/**
 * GET /sellers/kyc/:kycId/preview/:fileType
 * Get preview of decrypted KYC file (display in browser)
 * 
 * Usage:
 * GET /sellers/kyc/12345/preview/id_front
 */
router.get('/preview/:kycId/:fileType', authenticateUser, async (req, res) => {
    try {
        const user = req.user;
        const { kycId, fileType } = req.params;
        
        // Validate fileType
        if (!['id_front', 'id_back', 'selfie'].includes(fileType)) {
            return res.status(400).json({ message: 'Type de fichier invalide' });
        }

        // Verify seller owns this KYC document
        const { data: sellerRow, error: sellerFetchError } = await supabase
            .from('sellers')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (sellerFetchError || !sellerRow) {
            return res.status(401).json({ message: 'Non autorisé' });
        }

        // Verify KYC belongs to seller
        const { data: kycData, error: kycFetchError } = await supabase
            .from('kyc_documents')
            .select('id, seller_id')
            .eq('id', kycId)
            .eq('seller_id', sellerRow.id)
            .maybeSingle();

        if (kycFetchError || !kycData) {
            return res.status(404).json({ message: 'Document KYC non trouvé' });
        }

        // Get file metadata
        const { data: fileRecord, error: fileFetchError } = await supabase
            .from('kyc_files')
            .select(`${fileType}_url, ${fileType}_iv, ${fileType}_auth_tag, ${fileType}_hash`)
            .eq('kyc_document_id', kycId)
            .maybeSingle();

        if (fileFetchError || !fileRecord) {
            return res.status(404).json({ message: 'Fichier introuvable' });
        }

        const fileUrl = fileRecord[`${fileType}_url`];
        const fileIv = fileRecord[`${fileType}_iv`];
        const fileAuthTag = fileRecord[`${fileType}_auth_tag`];
        const fileHash = fileRecord[`${fileType}_hash`];

        if (!fileUrl || !fileIv || !fileAuthTag) {
            return res.status(404).json({ message: 'Métadonnées de fichier manquantes' });
        }

        // Download and decrypt file (same as download endpoint)
        const { data: encryptedBuffer, error: downloadError } = await supabase
            .storage
            .from('kyc_documents')
            .download(fileUrl);

        if (downloadError) {
            console.error('Error downloading file:', downloadError);
            return res.status(500).json({ message: 'Erreur lors du téléchargement du fichier' });
        }

        const decryptedBuffer = decryptFile(
            Buffer.from(encryptedBuffer),
            fileIv,
            fileAuthTag
        );

        // Verify integrity
        const calculatedHash = hashFile(decryptedBuffer);
        if (calculatedHash !== fileHash) {
            console.error('File integrity check failed');
            return res.status(500).json({ message: 'Erreur de vérification de l\'intégrité du fichier' });
        }

        // Send for preview (inline, not as attachment)
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(decryptedBuffer);

    } catch (error) {
        console.error('Error previewing file:', error);
        return res.status(500).json({ message: 'Erreur serveur interne' });
    }
});
