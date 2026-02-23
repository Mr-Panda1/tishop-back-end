# File Encryption Setup Guide

## Quick Start

### 1. Generate Encryption Key (One-time setup)

Run this command in your terminal:

```bash
node -e "const crypto = require('crypto'); console.log(crypto.randomBytes(32).toString('hex'))"
```

This will output a 32-byte hex string like:
```
a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
```

### 2. Add to Environment Variables

Create or update your `.env` file in the backend directory:

```env
ENCRYPTION_KEY=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
```

**IMPORTANT:** 
- Keep this key secure and never commit it to git
- Store it in a secure vault in production (AWS Secrets Manager, Azure Key Vault, etc.)
- Use the same key across all instances for consistency

### 3. Update .env.example (for team reference)

```env
# Encryption key for file encryption (generate with: node -e "const crypto = require('crypto'); console.log(crypto.randomBytes(32).toString('hex'))")
ENCRYPTION_KEY=<your-64-character-hex-string>
```

## Integration In KYC.js

### Before Uploading to Storage:

```javascript
const { encryptFile, hashFile } = require('../../../utils/encryption');

// When uploading a file
const fileBuffer = req.files[0].buffer;

// Encrypt the file
const { encryptedData, iv, authTag } = encryptFile(fileBuffer);

// Generate integrity hash
const fileHash = hashFile(fileBuffer);

// Upload encrypted data to storage
const { error: uploadError } = await supabase
    .storage
    .from('kyc_documents')
    .upload(filePath, encryptedData, {
        cacheControl: '3600',
        upsert: false,
        contentType: 'application/octet-stream'
    });

// Store metadata in database
const { error: dbError } = await supabase
    .from('kyc_documents')
    .insert([{
        // ... other fields
        file_path: filePath,
        file_hash: fileHash,
        encryption_iv: iv,
        encryption_tag: authTag,
        is_encrypted: true
    }]);
```

### When Retrieving/Downloading Files:

```javascript
const { decryptFile } = require('../../../utils/encryption');

// Get encrypted file from storage
const { data: encryptedBuffer, error: downloadError } = await supabase
    .storage
    .from('kyc_documents')
    .download(filePath);

// Get decryption metadata from database
const { data: docRecord } = await supabase
    .from('kyc_documents')
    .select('encryption_iv, encryption_tag, file_hash')
    .eq('id', docId)
    .single();

// Decrypt the file
const decryptedBuffer = decryptFile(
    encryptedBuffer,
    docRecord.encryption_iv,
    docRecord.encryption_tag
);

// Optional: Verify integrity
const { hashFile } = require('../../../utils/encryption');
const calculatedHash = hashFile(decryptedBuffer);
if (calculatedHash !== docRecord.file_hash) {
    throw new Error('File integrity check failed');
}
```

## Database Schema Updates

Add these columns to your `kyc_documents` table:

```sql
ALTER TABLE kyc_documents ADD COLUMN encryption_iv VARCHAR(255);
ALTER TABLE kyc_documents ADD COLUMN encryption_tag VARCHAR(255);
ALTER TABLE kyc_documents ADD COLUMN file_hash VARCHAR(255);
ALTER TABLE kyc_documents ADD COLUMN is_encrypted BOOLEAN DEFAULT true;
```

## Security Best Practices

1. **Key Management:**
   - Never hardcode keys in code
   - Use environment variables or secure vaults
   - Rotate keys periodically (implement key versioning)
   - Different keys for different environments (dev, staging, prod)

2. **Encryption Algorithm:**
   - Using AES-256-GCM (industry standard)
   - GCM mode provides authentication (prevents tampering)
   - Each file gets a unique IV (initialization vector)

3. **File Integrity:**
   - SHA-256 hash for integrity verification
   - Detect corruption or tampering
   - Asymmetric checks (hash != expected = reject)

4. **Storage Security:**
   - Encrypted files are safe even if storage is compromised
   - Combined with Supabase's storage security
   - Defense in depth approach

5. **Access Control:**
   - Still maintain RLS policies on kyc_documents table
   - Encryption is an additional layer
   - Only authenticated sellers can decrypt their own docs

## Testing Encryption

```javascript
// Test file: test-encryption.js
const { encryptFile, decryptFile, generateEncryptionKey, hashFile } = require('./src/utils/encryption');

// Set test key
process.env.ENCRYPTION_KEY = generateEncryptionKey();

const testData = Buffer.from('Hello, this is my KYC document');
console.log('Original:', testData.toString());

// Encrypt
const encrypted = encryptFile(testData);
console.log('Encrypted:', encrypted.encryptedData.toString('hex').slice(0, 50) + '...');

// Decrypt
const decrypted = decryptFile(encrypted.encryptedData, encrypted.iv, encrypted.authTag);
console.log('Decrypted:', decrypted.toString());

// Hash
const hash = hashFile(testData);
console.log('Hash:', hash);

console.log('✅ Encryption working correctly!');
```

Run with: `node test-encryption.js`

## Production Deployment Checklist

- [ ] Generate encryption key and store in secure vault
- [ ] Add ENCRYPTION_KEY to environment variables (all environments)
- [ ] Run database migration to add encryption columns
- [ ] Update kyc.js to use encryption
- [ ] Test encryption/decryption cycle
- [ ] Update documentation for team
- [ ] Monitor for decryption errors
- [ ] Implement key rotation strategy
- [ ] Backup encryption keys securely
