const env  = require('../db/env');
const moncash = require('moncash-sdk');

console.log('[Moncash Config] Loaded credentials:');
console.log('[Moncash Config] Client ID:', env.clientId ? `${env.clientId.substring(0, 8)}...` : 'MISSING');
console.log('[Moncash Config] Client Secret:', env.clientsecret ? `${env.clientsecret.substring(0, 8)}...` : 'MISSING');
console.log('[Moncash Config] Mode:', env.moncashMode);

console.log('[Moncash Config] Return URL:', env.moncashReturnUrl);
console.log('[Moncash Config] Webhook URL:', env.moncashWebhookUrl);

moncash.configure({
    'mode': env.moncashMode || 'sandbox',
    'client_id': env.clientId,
    'client_secret': env.clientsecret
});

console.log('[Moncash Config] Moncash configured successfully');
console.log('[Moncash Config] ⚠️  Make sure these match your MonCash business portal settings:');
console.log('[Moncash Config]   - Mode (sandbox/live) must match your credentials');
console.log('[Moncash Config]   - Return URL must match exactly: ' + env.moncashReturnUrl);

module.exports = moncash;