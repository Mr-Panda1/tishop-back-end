# MonCash Payment Setup Guide

This guide explains how to configure and test the MonCash payment integration on TiShop.

## Architecture Overview

```
User on tishop.co
       ↓
  Click "Pay"
       ↓
Frontend calls: POST https://pay.tishop.co/api/moncash/initiate
       ↓
Backend creates MonCash payment session
       ↓
Frontend redirected to: MonCash Gateway (handles PIN/phone input)
       ↓
After payment, MonCash returns to: GET https://pay.tishop.co/api/moncash/return
       ↓
Backend verifies payment, marks order as paid
       ↓
User redirected to: https://tishop.co/shop/order-confirmation?orderId=XXX
```

## Backend Configuration

### 1. Environment Variables (.env)

```env
# MonCash Credentials (from MonCash dashboard)
MONCASH_CLIENT_ID=your_client_id_here
MONCASH_CLIENT_SECRET=your_client_secret_here

# MonCash Mode: sandbox or production
MONCASH_MODE=sandbox

# Frontend domain for redirects after payment
FRONTEND_ORDER_CONFIRMATION_URL=https://tishop.co/shop/order-confirmation

# Payment bridge domain
MONCASH_RETURN_URL=https://pay.tishop.co/api/moncash/return
MONCASH_WEBHOOK_URL=https://pay.tishop.co/api/moncash/webhook
```

### 2. MonCash Dashboard Configuration

In your MonCash merchant account, set these 3 fields:

1. **Website Url**: `pay.tishop.co`
   - Your merchant domain (no protocol)

2. **Return Url** (Link to receive the payment Notification): `https://pay.tishop.co/api/moncash/return`
   - Where MonCash redirects user after payment
   - Backend verifies transaction here before marking order as paid

3. **Alert Url** (Thank you page): `https://tishop.co/shop/order-confirmation`
   - Final page shown to user after successful payment verification
   - Order confirmation page on main frontend domain

## Payment Flow Steps

### Step 1: User Creates Order & Initiates Payment (Frontend)

**File**: [PWA/tishop-pwa/app/shop/checkout/page.tsx](../../PWA/tishop-pwa/app/shop/checkout/page.tsx#L287)

```javascript
// Frontend creates order, then requests payment
const paymentResponse = await fetch(env.createPayment, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ orderId })
});

const paymentData = await paymentResponse.json();
window.location.href = paymentData.data.redirect_uri; // Go to MonCash
```

### Step 2: Backend Initiates Payment Session

**Endpoint**: `POST /api/moncash/initiate`

**File**: [backend/src/routes/payments/moncash.js](../src/routes/payments/moncash.js#L135)

Request body:
```json
{
  "orderId": "uuid-of-order"
}
```

Response:
```json
{
  "message": "Paiement créé avec succès",
  "data": {
    "payment_token": "token_string",
    "redirect_uri": "https://sandbox.moncashbutton.digicelgroup.com/...",
    "orderId": "uuid"
  }
}
```

### Step 3: MonCash Collects Payment Details

- User is redirected to MonCash gateway
- MonCash interface collects phone number and PIN
- User enters PIN to confirm payment
- MonCash processes the transaction

### Step 4: MonCash Returns to Backend

**Endpoint**: `GET /api/moncash/return`

**File**: [backend/src/routes/payments/moncash.js](../src/routes/payments/moncash.js#L196)

MonCash redirects to: `https://pay.tishop.co/api/moncash/return?transaction_id=XXX&order_id=YYY`

Backend actions:
1. Verifies transaction with MonCash API
2. Confirms payment status and amount
3. Marks order as paid in database
4. Generates delivery codes
5. Sends confirmation email
6. Redirects user to: `https://tishop.co/shop/order-confirmation?orderId=YYY`

### Step 5: MonCash Webhook (Optional - Server-to-Server)

**Endpoint**: `POST /api/moncash/webhook`

**File**: [backend/src/routes/payments/moncash.js](../src/routes/payments/moncash.js#L275)

This provides redundant verification. If configured, MonCash will also send a server-side notification about payment status.

## Testing

### Local Development

1. **Start backend**:
```bash
cd backend
npm start
```

Backend will be running on `localhost:3000`

2. **Simulate payment verification** (use the test email script):
```bash
cd backend
node src/email/test-email.js your-email@example.com
```

### Sandbox Testing with MonCash

1. Use sandbox credentials in `.env`:
```env
MONCASH_MODE=sandbox
MONCASH_CLIENT_ID=sandbox_client_id
MONCASH_CLIENT_SECRET=sandbox_secret
```

2. Test flow:
   - Frontend: http://localhost:3000/shop/checkout
   - Create an order → click "Pay"
   - You'll be redirected to MonCash sandbox
   - Use MonCash test phone numbers provided by MonCash support

### Sample Test Data

**MonCash Sandbox Test Numbers** (provided by MonCash):
- Test phone: Ask MonCash support for test numbers
- Test PIN: Ask MonCash support for test PINs

## Troubleshooting

### "User is Blocked" Error

**Cause**: Domain mismatch in MonCash configuration

**Solution**:
1. Verify `MONCASH_CLIENT_ID` and `MONCASH_CLIENT_SECRET` are correct
2. Confirm MonCash dashboard has **Website Url** set to `pay.tishop.co`
3. Confirm MonCash dashboard has **Return Url** set to `https://pay.tishop.co/api/moncash/return`
4. Check `MONCASH_MODE` matches your merchant account (sandbox vs production)

### Payment Not Verified

**Cause**: Return Url not configured in MonCash dashboard

**Solution**:
1. Log into MonCash merchant dashboard
2. Set **Return Url** field to: `https://pay.tishop.co/api/moncash/return`
3. Set **Alert Url** field to: `https://tishop.co/shop/order-confirmation`
4. Save and test again

### Order Not Marked as Paid

**Cause**: Database permissions or seller_orders table issue

**Solution**:
1. Check database connection: `curl https://your-backend/health`
2. Verify `seller_orders` table exists and has delivery_code_full column
3. Check backend logs for database errors

### Email Not Sending

**Cause**: Missing Brevo configuration

**Solution**:
1. Set email environment variables:
   ```env
   BREVO_EMAIL_USER=your-email@tishop.co
   BREVO_EMAIL_PASS=your-brevo-api-key
   BREVO_FROM_EMAIL=noreply@tishop.co
   ```
2. Test email: `node backend/src/email/test-email.js your-email@example.com`

## API Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/moncash/initiate` | Start payment (called from frontend) |
| GET | `/api/moncash/return` | Handle MonCash return (called by MonCash) |
| POST | `/api/moncash/webhook` | Server notification (called by MonCash) |
| POST | `/api/payments/mark-paid` | Manually mark order as paid (legacy) |

## Security Notes

1. **Never share** MONCASH_CLIENT_SECRET - keep in backend `.env` only
2. **Verify signatures** on webhook notifications (coming soon)
3. **Always verify** server-side before marking orders as paid
4. **Check amounts** match between order and MonCash response
5. **Validate order_id** matches the order in your database

## Next Steps

1. Get MonCash Test Credentials from MonCash (if not already done)
2. Obtain Brevo email service credentials
3. Configure DNS so `pay.tishop.co` points to your backend
4. Update `.env` with all credentials
5. Run test payment flow
6. Deploy to production when ready

## Support

For issues with MonCash integration, check:
- [MonCash API Documentation](https://developer.moncashbutton.com/)
- Backend logs: `docker logs tishop-backend` (or check PM2 logs)
- Database connection: Ensure Supabase is accessible
