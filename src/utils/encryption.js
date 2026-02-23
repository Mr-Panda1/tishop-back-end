const crypto = require('crypto');

// Get encryption key from environment or generate one
// In production, store this securely (e.g., AWS KMS, environment variable)
const getEncryptionKey = () => {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
        throw new Error('ENCRYPTION_KEY not set in environment variables');
    }
    // Ensure key is 32 bytes for AES-256
    if (key.length < 32) {
        throw new Error('ENCRYPTION_KEY must be at least 32 characters');
    }
    return key.slice(0, 32);
};

/**
 * Encrypt a buffer (file content) using AES-256-GCM
 * @param {Buffer} data - The file data to encrypt
 * @returns {Object} - { encryptedData, iv, authTag, algorithm }
 */
const encryptFile = (data) => {
    try {
        const algorithm = 'aes-256-gcm';
        const key = getEncryptionKey();
        const iv = crypto.randomBytes(16); // Initialization vector
        
        const cipher = crypto.createCipheriv(algorithm, Buffer.from(key, 'utf8'), iv);
        
        let encryptedData = cipher.update(data);
        encryptedData = Buffer.concat([encryptedData, cipher.final()]);
        
        const authTag = cipher.getAuthTag(); // Authentication tag for GCM mode
        
        return {
            encryptedData,
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex'),
            algorithm
        };
    } catch (error) {
        console.error('Encryption error:', error);
        throw new Error('Failed to encrypt file');
    }
};

/**
 * Decrypt a file that was encrypted with encryptFile
 * @param {Buffer} encryptedData - The encrypted file data
 * @param {string} iv - The initialization vector (hex string)
 * @param {string} authTag - The authentication tag (hex string)
 * @returns {Buffer} - The decrypted data
 */
const decryptFile = (encryptedData, iv, authTag) => {
    try {
        const algorithm = 'aes-256-gcm';
        const key = getEncryptionKey();
        
        const decipher = crypto.createDecipheriv(
            algorithm,
            Buffer.from(key, 'utf8'),
            Buffer.from(iv, 'hex')
        );
        
        decipher.setAuthTag(Buffer.from(authTag, 'hex'));
        
        let decryptedData = decipher.update(encryptedData);
        decryptedData = Buffer.concat([decryptedData, decipher.final()]);
        
        return decryptedData;
    } catch (error) {
        console.error('Decryption error:', error);
        throw new Error('Failed to decrypt file - data may be corrupted or key is incorrect');
    }
};

/**
 * Generate a random encryption key (32 bytes for AES-256)
 * Use this to generate a key to store in .env
 * @returns {string} - A 32-byte random key in hex format
 */
const generateEncryptionKey = () => {
    return crypto.randomBytes(32).toString('hex');
};

/**
 * Hash a file for integrity verification
 * @param {Buffer} data - The file data
 * @returns {string} - SHA-256 hash in hex format
 */
const hashFile = (data) => {
    return crypto.createHash('sha256').update(data).digest('hex');
};

module.exports = {
    encryptFile,
    decryptFile,
    generateEncryptionKey,
    hashFile,
    getEncryptionKey
};
