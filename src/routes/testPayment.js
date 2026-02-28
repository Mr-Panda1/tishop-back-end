const express = require('express');
const router = express.Router();

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
        
        <div id="result" class="result"></div>
        
        <div class="warning">
            <div class="warning-title">⚠️ Test Mode</div>
            <div class="warning-text">
                This is using MonCash Sandbox environment. Use test credentials to complete payment.
            </div>
        </div>
    </div>

    <script>
        async function createPayment() {
            const button = document.getElementById('payButton');
            const result = document.getElementById('result');
            const orderId = document.getElementById('orderId').textContent;
            const amount = parseFloat(document.getElementById('amount').textContent);
            
            // Disable button and show loading
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
                    } catch {
                        errorMsg = responseText.substring(0, 200);
                    }
                    throw new Error(errorMsg);
                }
                
                const data = JSON.parse(responseText);
                
                // Show success message
                result.className = 'result success';
                result.innerHTML = \`
                    <div class="result-title">✅ Payment Created Successfully!</div>
                    <div class="result-content">
                        <strong>Order ID:</strong> \${data.data.orderId}<br>
                        <strong>Amount:</strong> \${data.data.amount} HTG<br>
                        <strong>Mode:</strong> \${data.data.mode || 'sandbox'}<br>
                        <strong>Token:</strong> \${data.data.payment_token.substring(0, 40)}...<br><br>
                        <strong style="color: #059669;">🔄 Redirecting to MonCash in 2 seconds...</strong>
                    </div>
                \`;
                
                // Redirect after 2 seconds
                setTimeout(() => {
                    window.location.href = data.redirectUri;
                }, 2000);
                
            } catch (error) {
                console.error('Error:', error);
                result.className = 'result error';
                result.innerHTML = \`
                    <div class="result-title">❌ Error</div>
                    <div class="result-content">\${error.message}</div>
                \`;
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

        const moncash = require('../moncash/moncashConfig');

        const paymentData = {
            amount: parseFloat(amount),
            orderId: String(orderId)
        };

        moncash.payment.create(paymentData, function(error, payment) {
            if (error) {
                console.error('[Test Payment] Error:', error);
                return res.status(500).json({ 
                    error: error.message || 'Failed to create payment',
                    details: error.response
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
                }
            });
        });
    } catch (error) {
        console.error('[Test Payment] Unexpected error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
