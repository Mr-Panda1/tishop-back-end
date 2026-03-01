const axios = require('axios');
const crypto = require('crypto');

function normalizeMoncashMode(mode) {
    const rawMode = (mode || 'sandbox').toLowerCase().trim();

    if (['live', 'prod', 'production'].includes(rawMode)) {
        return 'live';
    }

    if (['sandbox', 'test'].includes(rawMode)) {
        return 'sandbox';
    }

    console.warn(`[Moncash Config] Unknown MONCASH_MODE "${mode}", defaulting to sandbox`);
    return 'sandbox';
}

const moncashMode = normalizeMoncashMode(process.env.MONCASH_MODE);
const moncashClientId = process.env.MONCASH_CLIENT_ID?.trim();
const moncashClientSecret = process.env.MONCASH_CLIENT_SECRET?.trim();
const moncashPortalUsername = process.env.MONCASH_PORTAL_USERNAME?.trim();
const moncashPortalPassword = process.env.MONCASH_PORTAL_PASSWORD?.trim();
const moncashPluginBusinessKey = process.env.MONCASH_PLUGIN_BUSINESS_KEY?.trim() || process.env.MONCASH_BUSINESS_KEY?.trim() || process.env.BUSINESS_KEY?.trim();
const moncashPluginPublicKey = process.env.MONCASH_PLUGIN_PUBLIC_KEY?.trim() || process.env.MONCASH_PUBLIC_KEY?.trim() || process.env.MONCASH_SECRET_KEY?.trim() || process.env.SECRET_KEY?.trim() || process.env.BUSINESS_KEY?.trim();
const moncashReturnUrl = process.env.MONCASH_RETURN_URL || 'https://pay.tishop.co/api/moncash/return';
const moncashWebhookUrl = process.env.MONCASH_WEBHOOK_URL || 'https://pay.tishop.co/api/moncash/webhook';

if (!moncashClientId || !moncashClientSecret) {
    throw new Error('[Moncash Config] Missing MONCASH_CLIENT_ID or MONCASH_CLIENT_SECRET in environment');
}

console.log('[Moncash Config] Loaded credentials:');
console.log('[Moncash Config] Client ID:', moncashClientId ? `${moncashClientId.substring(0, 8)}...` : 'MISSING');
console.log('[Moncash Config] Client Secret:', moncashClientSecret ? `${moncashClientSecret.substring(0, 8)}...` : 'MISSING');
console.log('[Moncash Config] Portal Username:', moncashPortalUsername || 'NOT SET (required for MerchantApi)');
console.log('[Moncash Config] Mode:', moncashMode);

console.log('[Moncash Config] Return URL:', moncashReturnUrl);
console.log('[Moncash Config] Webhook URL:', moncashWebhookUrl);

// Configuration
const config = {
    mode: moncashMode,
    client_id: moncashClientId,
    client_secret: moncashClientSecret
};

// Get API base URL based on mode
const getApiBaseUrl = (mode) => {
    return mode === 'live' 
        ? 'https://moncashbutton.digicelgroup.com/Api'
        : 'https://sandbox.moncashbutton.digicelgroup.com/Api';
};

// Get base domain URL (without /Api suffix)
const getBaseUrl = (mode) => {
    return mode === 'live' 
        ? 'https://moncashbutton.digicelgroup.com'
        : 'https://sandbox.moncashbutton.digicelgroup.com';
};

// Get gateway URL for redirects
const getGatewayUrl = (mode) => {
    return mode === 'live'
        ? 'https://moncashbutton.digicelgroup.com/Moncash-middleware'
        : 'https://sandbox.moncashbutton.digicelgroup.com/Moncash-middleware';
};

const API_BASE_URL = getApiBaseUrl(config.mode);
const BASE_URL = getBaseUrl(config.mode);
const GATEWAY_URL = getGatewayUrl(config.mode);

function toUrlSafeBase64(buffer) {
    return buffer
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function toPublicKeyPem(rawKey) {
    if (!rawKey) {
        return null;
    }

    if (rawKey.includes('BEGIN PUBLIC KEY')) {
        return rawKey;
    }

    const normalized = rawKey.replace(/\s+/g, '');
    const chunks = normalized.match(/.{1,64}/g) || [];
    return `-----BEGIN PUBLIC KEY-----\n${chunks.join('\n')}\n-----END PUBLIC KEY-----`;
}

function looksLikePublicKey(value) {
    if (!value) {
        return false;
    }

    // RSA keys have specific characteristics:
    // 1. Have PEM BEGIN/END markers, OR
    // 2. DER-encoded RSA keys (base64) typically start with MD (30 in hex = MD in base64)
    //    Common prefixes: MDww, MDcw, MIIx, MIIC, etc.
    const trimmed = value.trim();
    return trimmed.includes('BEGIN PUBLIC KEY') 
        || /^M(D|II)[A-Za-z0-9+/]/.test(trimmed);
}

function looksLikeBusinessKey(value) {
    if (!value) {
        return false;
    }

    // Business key is base64 or alphanumeric, typically 20-100+ chars
    const normalized = value.replace(/\s+/g, '');
    const isValidFormat = /^[A-Za-z0-9+/=_-]+$/.test(normalized);
    const isReasonableLength = normalized.length >= 16 && normalized.length <= 300;
    
    return isValidFormat && isReasonableLength;
}

function rsaEncryptNoPadding(value, publicKeyPem) {
    if (!publicKeyPem) {
        throw new Error('Missing MonCash plugin public key');
    }

    const keyObject = crypto.createPublicKey(publicKeyPem);
    const modulusBits = keyObject.asymmetricKeyDetails?.modulusLength;

    if (!modulusBits) {
        throw new Error('Unable to determine RSA modulus length for MonCash plugin key');
    }

    const blockSize = Math.ceil(modulusBits / 8);
    const plainBuffer = Buffer.from(String(value), 'utf8');

    if (plainBuffer.length > blockSize) {
        throw new Error('Value too long for MonCash plugin RSA encryption');
    }

    const padded = Buffer.alloc(blockSize, 0);
    plainBuffer.copy(padded, blockSize - plainBuffer.length);

    const encrypted = crypto.publicEncrypt(
        {
            key: keyObject,
            padding: crypto.constants.RSA_NO_PADDING
        },
        padded
    );

    return toUrlSafeBase64(encrypted);
}

// Token cache
let tokenCache = null;
let tokenExpiry = null;
let merchantTokenCache = null;
let merchantTokenExpiry = null;

// Generate OAuth token for Button/Plugin APIs
async function generateToken() {
    // Return cached token if still valid
    if (tokenCache && tokenExpiry && Date.now() < tokenExpiry) {
        return tokenCache;
    }

    try {
        // Create Basic Auth header
        const credentials = Buffer.from(`${config.client_id}:${config.client_secret}`).toString('base64');
        
        const response = await axios.post(
            `${API_BASE_URL}/oauth/token`,
            'scope=read,write&grant_type=client_credentials',
            {
                timeout: 15000,
                headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        tokenCache = response.data.access_token;
        const expiresInMs = Math.max(((response.data.expires_in || 59) - 5) * 1000, 1000);
        tokenExpiry = Date.now() + expiresInMs;
        
        console.log('[Moncash] OAuth token generated successfully');
        return tokenCache;
    } catch (error) {
        console.error('[Moncash] Token generation failed:', error.response?.data || error.message);
        throw new Error('Failed to generate MonCash token');
    }
}

// Generate OAuth token for MerchantApi
async function generateMerchantToken() {
    // Return cached token if still valid
    if (merchantTokenCache && merchantTokenExpiry && Date.now() < merchantTokenExpiry) {
        return merchantTokenCache;
    }

    try {
        // Try with REST API client_id/client_secret first (most likely to work)
        const FormData = require('form-data');
        const form = new FormData();
        form.append('scope', 'read,write');
        form.append('grant_type', 'client_credentials');
        
        const response = await axios.post(
            `${BASE_URL}/MerChantApi/oauth/token`,
            form,
            {
                timeout: 15000,
                headers: {
                    ...form.getHeaders()
                },
                auth: {
                    username: config.client_id,
                    password: config.client_secret
                }
            }
        );

        merchantTokenCache = response.data.access_token;
        const expiresInMs = Math.max(((response.data.expires_in || 59) - 5) * 1000, 1000);
        merchantTokenExpiry = Date.now() + expiresInMs;
        
        console.log('[Moncash MerchantApi] OAuth token generated successfully');
        return merchantTokenCache;
    } catch (error) {
        console.error('[Moncash MerchantApi] Token generation failed:');
        console.error('[Moncash MerchantApi] Status:', error.response?.status);
        console.error('[Moncash MerchantApi] Response:', JSON.stringify(error.response?.data, null, 2));
        console.error('[Moncash MerchantApi] Error message:', error.message);
        
        const errorDetails = error.response?.data || error.message;
        throw new Error(`Failed to generate MonCash MerchantApi token: ${JSON.stringify(errorDetails)}`);
    }
}

// MonCash client object
const moncash = {
    plugin: {
        create: async function(paymentData, callback) {
            try {
                if (!moncashPluginBusinessKey || !moncashPluginPublicKey) {
                    throw {
                        message: 'Missing MONCASH_PLUGIN_BUSINESS_KEY/MONCASH_PLUGIN_PUBLIC_KEY (or BUSINESS_KEY) for plugin flow',
                        httpStatusCode: 500
                    };
                }

                if (!looksLikeBusinessKey(moncashPluginBusinessKey) || looksLikePublicKey(moncashPluginBusinessKey)) {
                    throw {
                        message: 'Invalid MonCash plugin business key. Use MONCASH_PLUGIN_BUSINESS_KEY (merchant key), not the RSA public key.',
                        httpStatusCode: 500
                    };
                }

                if (!looksLikePublicKey(moncashPluginPublicKey)) {
                    throw {
                        message: 'Invalid MonCash plugin public key. Set MONCASH_PLUGIN_PUBLIC_KEY with the RSA public key from MonCash.',
                        httpStatusCode: 500
                    };
                }

                const publicKeyPem = toPublicKeyPem(moncashPluginPublicKey);
                const encryptedOrderId = rsaEncryptNoPadding(String(paymentData.orderId), publicKeyPem);
                const encryptedAmount = rsaEncryptNoPadding(String(paymentData.amount), publicKeyPem);
                const businessKeyPath = encodeURIComponent(moncashPluginBusinessKey);

                const body = new URLSearchParams({
                    orderId: encryptedOrderId,
                    amount: encryptedAmount
                }).toString();

                const response = await axios.post(
                    `${GATEWAY_URL}/Checkout/Rest/${businessKeyPath}`,
                    body,
                    {
                        timeout: 20000,
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        }
                    }
                );

                const responseData = response.data || {};

                if (!responseData.success || !responseData.token) {
                    throw {
                        message: responseData.message || 'Invalid plugin payment response',
                        response: responseData,
                        httpStatusCode: response.status || 500
                    };
                }

                const normalized = {
                    success: true,
                    mode: config.mode,
                    payment_token: {
                        token: responseData.token
                    },
                    raw: responseData
                };

                if (callback) {
                    callback(null, normalized);
                }

                return normalized;
            } catch (error) {
                const errorObj = {
                    message: error.response?.data?.message || error.message || 'MonCash plugin payment failed',
                    response: error.response?.data || error.response,
                    httpStatusCode: error.response?.status || error.httpStatusCode || 500
                };

                if (callback) {
                    callback(errorObj, null);
                    return;
                }

                throw errorObj;
            }
        },

        redirect_uri: function(payment) {
            const token = payment?.payment_token?.token || payment?.token;

            if (!token) {
                throw new Error('Invalid plugin payment object');
            }

            return `${GATEWAY_URL}/Payment/Redirect?token=${token}`;
        }
    },

    payment: {
        // Create a payment
        create: async function(paymentData, callback) {
            try {
                const token = await generateToken();
                
                const response = await axios.post(
                    `${API_BASE_URL}/v1/CreatePayment`,
                    {
                        amount: paymentData.amount,
                        orderId: paymentData.orderId
                    },
                    {
                        timeout: 20000,
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                // Call callback with null error and payment data
                if (callback) {
                    callback(null, response.data);
                }
                return response.data;
            } catch (error) {
                const errorObj = {
                    message: error.response?.data?.message || error.message,
                    response: error.response?.data,
                    httpStatusCode: error.response?.status
                };
                
                if (callback) {
                    callback(errorObj, null);
                } else {
                    throw errorObj;
                }
            }
        },

        // Generate redirect URI from payment response
        redirect_uri: function(payment) {
            if (!payment || !payment.payment_token || !payment.payment_token.token) {
                throw new Error('Invalid payment object');
            }
            return `${GATEWAY_URL}/Payment/Redirect?token=${payment.payment_token.token}`;
        }
    },

    capture: {
        // Get payment details by transaction ID
        getByTransactionId: async function(transactionId, callback) {
            try {
                const token = await generateToken();
                
                const response = await axios.get(
                    `${API_BASE_URL}/v1/RetrieveTransactionPayment`,
                    {
                        timeout: 20000,
                        params: { transactionId },
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    }
                );

                if (callback) {
                    callback(null, response.data);
                }
                return response.data;
            } catch (error) {
                const errorObj = {
                    message: error.response?.data?.message || error.message,
                    response: error.response?.data,
                    httpStatusCode: error.response?.status
                };
                
                if (callback) {
                    callback(errorObj, null);
                } else {
                    throw errorObj;
                }
            }
        }
    },

    merchant: {
        // MerchantApi V1 - Payment (auto-polling for 2 minutes)
        payment: async function(paymentData, callback) {
            try {
                const token = await generateMerchantToken();
                
                const response = await axios.post(
                    `${BASE_URL}/MerChantApi/V1/Payment`,
                    {
                        reference: String(paymentData.reference || paymentData.orderId),
                        account: String(paymentData.account),
                        amount: parseFloat(paymentData.amount)
                    },
                    {
                        timeout: 150000, // 2.5 minutes (API polls for 2 minutes)
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                const normalized = {
                    success: response.data.status === 200,
                    mode: response.data.mode,
                    reference: response.data.reference,
                    transactionId: response.data.transactionId,
                    account: response.data.account,
                    amount: response.data.amount,
                    timestamp: response.data.timestamp,
                    status: response.data.status,
                    raw: response.data
                };

                if (callback) {
                    callback(null, normalized);
                }
                return normalized;
            } catch (error) {
                const errorObj = {
                    message: error.response?.data?.message || error.message,
                    response: error.response?.data,
                    httpStatusCode: error.response?.status
                };
                
                if (callback) {
                    callback(errorObj, null);
                } else {
                    throw errorObj;
                }
            }
        },

        // MerchantApi V1 - InitiatePayment (returns pending, requires manual polling)
        initiatePayment: async function(paymentData, callback) {
            try {
                const token = await generateMerchantToken();
                
                const response = await axios.post(
                    `${BASE_URL}/MerChantApi/V1/InitiatePayment`,
                    {
                        reference: String(paymentData.reference || paymentData.orderId),
                        account: String(paymentData.account),
                        amount: parseFloat(paymentData.amount)
                    },
                    {
                        timeout: 20000,
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                const normalized = {
                    success: response.data.status === 201,
                    mode: response.data.mode,
                    reference: response.data.reference,
                    message: response.data.message,
                    transactionId: response.data.transactionId,
                    timestamp: response.data.timestamp,
                    status: response.data.status,
                    raw: response.data
                };

                if (callback) {
                    callback(null, normalized);
                }
                return normalized;
            } catch (error) {
                const errorObj = {
                    message: error.response?.data?.message || error.message,
                    response: error.response?.data,
                    httpStatusCode: error.response?.status
                };
                
                if (callback) {
                    callback(errorObj, null);
                } else {
                    throw errorObj;
                }
            }
        },

        // MerchantApi V1 - CheckPayment
        checkPayment: async function(query, callback) {
            try {
                const token = await generateMerchantToken();
                
                const body = query.transactionId 
                    ? { transactionId: String(query.transactionId) }
                    : { reference: String(query.reference) };
                
                const response = await axios.post(
                    `${BASE_URL}/MerChantApi/V1/CheckPayment`,
                    body,
                    {
                        timeout: 20000,
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                const normalized = {
                    success: response.data.status === 200,
                    mode: response.data.mode,
                    reference: response.data.reference,
                    message: response.data.message,
                    transactionId: response.data.transactionId,
                    account: response.data.account,
                    amount: response.data.amount,
                    timestamp: response.data.timestamp,
                    status: response.data.status,
                    raw: response.data
                };

                if (callback) {
                    callback(null, normalized);
                }
                return normalized;
            } catch (error) {
                const errorObj = {
                    message: error.response?.data?.message || error.message,
                    response: error.response?.data,
                    httpStatusCode: error.response?.status
                };
                
                if (callback) {
                    callback(errorObj, null);
                } else {
                    throw errorObj;
                }
            }
        }
    },

    debug: {
        getAccessToken: async function(forceRefresh = false) {
            if (forceRefresh) {
                tokenCache = null;
                tokenExpiry = null;
            }

            const token = await generateToken();
            return {
                access_token: token,
                token_type: 'bearer',
                expires_at: tokenExpiry,
                mode: config.mode,
                api_base_url: API_BASE_URL
            };
        },

        getConfig: function() {
            return {
                mode: config.mode,
                client_id_preview: config.client_id ? `${config.client_id.substring(0, 8)}...` : 'MISSING',
                api_base_url: API_BASE_URL,
                gateway_url: GATEWAY_URL
            };
        }
    }
};

console.log('[Moncash Config] Moncash configured successfully (Axios-based client)');
console.log('[Moncash Config] ⚠️  Make sure these match your MonCash business portal settings:');
console.log('[Moncash Config]   - Mode (sandbox/live) must match your credentials');
console.log('[Moncash Config]   - Return URL must match exactly: ' + moncashReturnUrl);

// Export utilities for use in other modules
moncash.utils = {
    toPublicKeyPem,
    rsaEncryptNoPadding,
    toUrlSafeBase64,
    looksLikePublicKey,
    looksLikeBusinessKey
};

module.exports = moncash;