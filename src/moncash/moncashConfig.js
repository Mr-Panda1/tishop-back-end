const axios = require('axios');

const moncashMode = process.env.MONCASH_MODE || 'sandbox';
const moncashClientId = process.env.MONCASH_CLIENT_ID || '2fd21ecb4a736cc2a82fc6d9fcc8739a';
const moncashClientSecret = process.env.MONCASH_CLIENT_SECRET || 'cC2YgozrT66gdI5pFzrYRhBBRr8UQpWHOiCBiXgQ1I0kKbwNPd87fy64m_w04dQs';
const moncashReturnUrl = process.env.MONCASH_RETURN_URL || 'https://pay.tishop.co/api/moncash/return';
const moncashWebhookUrl = process.env.MONCASH_WEBHOOK_URL || 'https://pay.tishop.co/api/moncash/webhook';

console.log('[Moncash Config] Loaded credentials:');
console.log('[Moncash Config] Client ID:', moncashClientId ? `${moncashClientId.substring(0, 8)}...` : 'MISSING');
console.log('[Moncash Config] Client Secret:', moncashClientSecret ? `${moncashClientSecret.substring(0, 8)}...` : 'MISSING');
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

// Get gateway URL for redirects
const getGatewayUrl = (mode) => {
    return mode === 'live'
        ? 'https://moncashbutton.digicelgroup.com/Moncash-middleware'
        : 'https://sandbox.moncashbutton.digicelgroup.com/Moncash-middleware';
};

const API_BASE_URL = getApiBaseUrl(config.mode);
const GATEWAY_URL = getGatewayUrl(config.mode);

// Token cache
let tokenCache = null;
let tokenExpiry = null;

// Generate OAuth token
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
                headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        tokenCache = response.data.access_token;
        // Token expires in ~59 seconds, cache for 50 seconds to be safe
        tokenExpiry = Date.now() + 50000;
        
        console.log('[Moncash] OAuth token generated successfully');
        return tokenCache;
    } catch (error) {
        console.error('[Moncash] Token generation failed:', error.response?.data || error.message);
        throw new Error('Failed to generate MonCash token');
    }
}

// MonCash client object
const moncash = {
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

module.exports = moncash;