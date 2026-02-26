/**
 * Test script for MonCash payment endpoint
 * Run: node test-payment-endpoint.js
 */

const env = require('./src/db/env');

console.log('\n=== Testing Payment Endpoint Configuration ===\n');

// 1. Check MonCash credentials
console.log('1. MonCash Configuration:');
console.log('   Client ID:', env.clientId ? `✓ Set (${env.clientId.substring(0, 8)}...)` : '✗ MISSING');
console.log('   Client Secret:', env.clientsecret ? `✓ Set (${env.clientsecret.substring(0, 8)}...)` : '✗ MISSING');
console.log('   Mode:', env.moncashMode);
console.log('   Return URL:', env.moncashReturnUrl);

// 2. Check database connection
console.log('\n2. Database Configuration:');
console.log('   Supabase URL:', env.supabaseUrl ? '✓ Set' : '✗ MISSING');
console.log('   Supabase Key:', env.supabaseSecret ? '✓ Set' : '✗ MISSING');

// 3. Test database connection
console.log('\n3. Testing Database Connection...');
const { supabase } = require('./src/db/supabase');

(async () => {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select('id, order_number, total_amount, status')
            .limit(1);
        
        if (error) {
            console.log('   ✗ Database Error:', error.message);
        } else {
            console.log('   ✓ Database connected successfully');
            console.log('   Found', data?.length || 0, 'sample order(s)');
        }
    } catch (err) {
        console.log('   ✗ Connection Error:', err.message);
    }

    // 4. Test MonCash SDK
    console.log('\n4. Testing MonCash SDK...');
    try {
        const moncash = require('./src/moncash/moncashConfig');
        console.log('   ✓ MonCash SDK loaded');
        
        // Try to create a test payment
        if (env.clientId && env.clientsecret) {
            console.log('   Attempting test payment creation...');
            
            moncash.payment.create({
                amount: 100,
                orderId: 'test-order-123'
            }, function(error, payment) {
                if (error) {
                    console.log('   ✗ Payment creation failed:', error.message);
                    if (error.response) {
                        console.log('   Response:', JSON.stringify(error.response, null, 2));
                    }
                } else {
                    console.log('   ✓ Test payment created successfully!');
                    console.log('   Payment token:', payment.payment_token?.token?.substring(0, 30) + '...');
                }
                
                console.log('\n=== Test Complete ===\n');
                process.exit(0);
            });
        } else {
            console.log('   ⚠ Cannot test payment - credentials missing');
            console.log('\n=== Test Complete ===\n');
            process.exit(0);
        }
    } catch (err) {
        console.log('   ✗ MonCash SDK Error:', err.message);
        console.log('\n=== Test Complete ===\n');
        process.exit(1);
    }
})();
