const crypto = require('crypto');

const TEXT_ENCRYPTION_VERSION = 'enc:v1';

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

const isEncryptedText = (value) => {
    return typeof value === 'string' && value.startsWith(`${TEXT_ENCRYPTION_VERSION}:`);
};

const encryptText = (value) => {
    if (value == null) {
        return value;
    }

    const plainText = String(value);
    if (!plainText) {
        return plainText;
    }

    if (isEncryptedText(plainText)) {
        return plainText;
    }

    try {
        const algorithm = 'aes-256-gcm';
        const key = getEncryptionKey();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, Buffer.from(key, 'utf8'), iv);

        let encrypted = cipher.update(plainText, 'utf8', 'base64');
        encrypted += cipher.final('base64');

        const authTag = cipher.getAuthTag().toString('base64');
        return `${TEXT_ENCRYPTION_VERSION}:${iv.toString('base64')}:${authTag}:${encrypted}`;
    } catch (error) {
        console.error('Text encryption error:', error);
        throw new Error('Failed to encrypt text');
    }
};

const decryptText = (value) => {
    if (value == null || typeof value !== 'string' || !value) {
        return value;
    }

    if (!isEncryptedText(value)) {
        return value;
    }

    try {
        const [, version, ivBase64, authTagBase64, encrypted] = value.split(':');
        if (!version || !ivBase64 || !authTagBase64 || !encrypted) {
            throw new Error('Invalid encrypted text payload');
        }

        const algorithm = 'aes-256-gcm';
        const key = getEncryptionKey();
        const decipher = crypto.createDecipheriv(
            algorithm,
            Buffer.from(key, 'utf8'),
            Buffer.from(ivBase64, 'base64')
        );

        decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'));

        let decrypted = decipher.update(encrypted, 'base64', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        console.error('Text decryption error:', error);
        throw new Error('Failed to decrypt text');
    }
};

const encryptFields = (row, fieldList = []) => {
    if (!row || typeof row !== 'object') {
        return row;
    }

    return fieldList.reduce((accumulator, fieldName) => {
        if (Object.prototype.hasOwnProperty.call(accumulator, fieldName)) {
            accumulator[fieldName] = encryptText(accumulator[fieldName]);
        }
        return accumulator;
    }, { ...row });
};

const decryptFields = (row, fieldList = []) => {
    if (!row || typeof row !== 'object') {
        return row;
    }

    return fieldList.reduce((accumulator, fieldName) => {
        if (Object.prototype.hasOwnProperty.call(accumulator, fieldName)) {
            accumulator[fieldName] = decryptText(accumulator[fieldName]);
        }
        return accumulator;
    }, { ...row });
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
    encryptText,
    decryptText,
    isEncryptedText,
    encryptFields,
    decryptFields,
    generateEncryptionKey,
    hashFile,
    getEncryptionKey
};
