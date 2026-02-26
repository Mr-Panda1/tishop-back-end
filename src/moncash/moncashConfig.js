const env  = require('../db/env');
const moncash = require('moncash-sdk');

console.log('[Moncash Config] Loaded credentials:');
console.log('[Moncash Config] Client ID:', env.clientId ? `${env.clientId.substring(0, 8)}...` : 'MISSING');
console.log('[Moncash Config] Client Secret:', env.clientsecret ? `${env.clientsecret.substring(0, 8)}...` : 'MISSING');
console.log('[Moncash Config] Mode:', env.moncashMode);

moncash.configure({
    'mode': env.moncashMode || 'sandbox',
    'client_id': env.clientId,
    'client_secret': env.clientsecret
});

console.log('[Moncash Config] Moncash configured successfully');

module.exports = moncash;