const express = require('express');
const router = express.Router();
const moncash = require('../moncash/moncashConfig');

router.get('/token', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === '1';
        const tokenData = await moncash.debug.getAccessToken(forceRefresh);
        return res.json({ success: true, ...tokenData });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to get token'
        });
    }
});

/**
 * GET /api/test-payment
 * Serve a simple HTML page to test MonCash payment
 */
router.get('/', (req, res) => {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MonCash Payment Test</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 40px;
            max-width: 500px;
            width: 100%;
        }
        h1 {
            color: #1a202c;
            font-size: 28px;
            margin-bottom: 24px;
            text-align: center;
        }
        .info-box {
            background: #f7fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 16px;
        }
        .info-label {
            color: #718096;
            font-size: 12px;
            margin-bottom: 4px;
        }
        .info-value {
            color: #2d3748;
            font-family: 'Courier New', monospace;
            font-size: 16px;
            font-weight: 600;
        }
        button {
            width: 100%;
            background: #667eea;
            color: white;
            border: none;
            padding: 16px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        button:hover:not(:disabled) {
            background: #5a67d8;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        button:disabled {
            background: #cbd5e0;
            cursor: not-allowed;
        }
        .result {
            margin-top: 20px;
            padding: 16px;
            border-radius: 8px;
            display: none;
        }
        .result.success {
            background: #f0fdf4;
            border: 1px solid #86efac;
            display: block;
        }
        .result.error {
            background: #fef2f2;
            border: 1px solid #fca5a5;
            display: block;
        }
        .result-title {
            font-weight: 600;
            margin-bottom: 8px;
        }
        .result.success .result-title {
            color: #166534;
        }
        .result.error .result-title {
            color: #991b1b;
        }
        .result-content {
            font-size: 14px;
            line-height: 1.6;
        }
        .result.success .result-content {
            color: #15803d;
        }
        .result.error .result-content {
            color: #dc2626;
        }
        .warning {
            background: #fffbeb;
            border: 1px solid #fde68a;
            border-radius: 8px;
            padding: 12px;
            margin-top: 20px;
        }
        .warning-title {
            color: #92400e;
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 4px;
        }
        .warning-text {
            color: #b45309;
            font-size: 11px;
        }
        .spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid #fff;
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
            margin-right: 8px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 MonCash Payment Test</h1>
        
        <div class="info-box">
            <div class="info-label">Test Order ID:</div>
            <div class="info-value" id="orderId">TEST-ORDER-123</div>
        </div>
        
        <div class="info-box">
            <div class="info-label">Test Amount:</div>
            <div class="info-value" id="amount">100 HTG</div>
        </div>
        
        <button id="payButton" onclick="createPayment()">
            Create Test Payment
        </button>
        <button id="tokenButton" onclick="showToken()" style="margin-top: 10px; background: #111827;">
            Show OAuth Token
        </button>
        
        <div id="result" class="result"></div>
        
        <div class="warning">
            <div class="warning-title">⚠️ Test Mode</div>
            <div class="warning-text">
                This is using MonCash Sandbox environment. Use test credentials to complete payment.
            </div>
        </div>
    </div>

    <script>
        async function showToken() {
            const result = document.getElementById('result');
            const tokenButton = document.getElementById('tokenButton');

            tokenButton.disabled = true;
            tokenButton.innerHTML = '<span class="spinner"></span>Fetching Token...';

            try {
                const response = await fetch('/api/test-payment/token?refresh=1');
                const data = await response.json();

                if (!response.ok || !data.success) {
                    throw new Error(data.error || 'Failed to fetch token');
                }

                result.className = 'result success';
                result.innerHTML =
                    '<div class="result-title">🔐 OAuth Token</div>' +
                    '<div class="result-content">' +
                    '<strong>Mode:</strong> ' + data.mode + '<br>' +
                    '<strong>API:</strong> ' + data.api_base_url + '<br>' +
                    '<strong>Type:</strong> ' + data.token_type + '<br>' +
                    '<strong>Access Token:</strong><br>' +
                    '<span style="word-break: break-all; font-size: 10px; font-family: monospace;">' + data.access_token + '</span>' +
                    '</div>';
            } catch (error) {
                result.className = 'result error';
                result.innerHTML =
                    '<div class="result-title">❌ Token Error</div>' +
                    '<div class="result-content">' + error.message + '</div>';
            } finally {
                tokenButton.disabled = false;
                tokenButton.innerHTML = 'Show OAuth Token';
            }
        }

        async function createPayment() {
            const button = document.getElementById('payButton');
            const result = document.getElementById('result');
            const orderId = document.getElementById('orderId').textContent;
            const amount = parseFloat(document.getElementById('amount').textContent);

            button.disabled = true;
            button.innerHTML = '<span class="spinner"></span>Creating Payment...';
            result.style.display = 'none';
            result.className = 'result';

            try {
                const response = await fetch('/api/test-payment/create', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ orderId, amount })
                });

                const responseText = await response.text();
                console.log('Response:', responseText);

                if (!response.ok) {
                    let errorMsg = 'Failed to create payment';
                    try {
                        const errorData = JSON.parse(responseText);
                        errorMsg = errorData.error || errorData.details || errorMsg;
                        if (errorData.auth && errorData.auth.access_token) {
                            errorMsg += '\n\nAuth token used:\n' + errorData.auth.access_token;
                        }
                    } catch {
                        errorMsg = responseText.substring(0, 200);
                    }
                    throw new Error(errorMsg);
                }

                const data = JSON.parse(responseText);
                const authToken = data.auth && data.auth.access_token ? data.auth.access_token : 'N/A';
                const paymentToken = data.data && data.data.payment_token ? data.data.payment_token : '';

                result.className = 'result success';
                result.innerHTML =
                    '<div class="result-title">✅ Payment Created Successfully!</div>' +
                    '<div class="result-content">' +
                    '<strong>Order ID:</strong> ' + data.data.orderId + '<br>' +
                    '<strong>Amount:</strong> ' + data.data.amount + ' HTG<br>' +
                    '<strong>Mode:</strong> ' + (data.data.mode || 'sandbox') + '<br>' +
                    '<strong>Token:</strong> ' + paymentToken.substring(0, 40) + '...<br><br>' +
                    '<strong>Auth token used:</strong><br>' +
                    '<span style="word-break: break-all; font-size: 10px; font-family: monospace;">' + authToken + '</span><br><br>' +
                    '<strong style="color: #059669;">🔄 Redirecting to MonCash in 2 seconds...</strong>' +
                    '</div>';

                setTimeout(() => {
                    window.location.href = data.redirectUri;
                }, 2000);

            } catch (error) {
                console.error('Error:', error);
                result.className = 'result error';
                result.innerHTML =
                    '<div class="result-title">❌ Error</div>' +
                    '<div class="result-content">' + error.message + '</div>';
                button.disabled = false;
                button.innerHTML = 'Create Test Payment';
            }
        }
    </script>
</body>
</html>
    `;
    
    res.send(html);
});

/**
 * POST /api/test-payment/create
 * Simple test endpoint to create a MonCash payment without database lookup
 * For testing MonCash integration only
 */
router.post('/create', async (req, res) => {
    try {
        const { orderId, amount } = req.body;

        if (!orderId || !amount) {
            return res.status(400).json({ error: 'orderId and amount are required' });
        }

        console.log('[Test Payment] Creating test payment:', { orderId, amount });

        const paymentData = {
            amount: parseFloat(amount),
            orderId: String(orderId)
        };

        const tokenData = await moncash.debug.getAccessToken();

        moncash.payment.create(paymentData, function(error, payment) {
            if (error) {
                console.error('[Test Payment] Error:', error);
                return res.status(500).json({ 
                    error: error.message || 'Failed to create payment',
                    details: error.response,
                    auth: {
                        access_token: tokenData.access_token,
                        token_type: tokenData.token_type,
                        mode: tokenData.mode,
                        api_base_url: tokenData.api_base_url
                    }
                });
            }

            if (!payment || !payment.payment_token) {
                console.error('[Test Payment] Invalid payment response:', payment);
                return res.status(500).json({ error: 'Invalid MonCash response' });
            }

            console.log('[Test Payment] Payment created successfully');

            const redirectUri = moncash.payment.redirect_uri(payment);
            
            return res.json({ 
                success: true, 
                redirectUri,
                data: {
                    payment_token: payment.payment_token.token,
                    orderId: paymentData.orderId,
                    amount: paymentData.amount,
                    status: payment.status,
                    mode: payment.mode
                },
                auth: {
                    access_token: tokenData.access_token,
                    token_type: tokenData.token_type,
                    mode: tokenData.mode,
                    api_base_url: tokenData.api_base_url
                }
            });
        });
    } catch (error) {
        console.error('[Test Payment] Unexpected error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
