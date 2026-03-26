const env = require('../db/env');

const DEFAULT_FROM_EMAIL = env.fromEmail;
const DEFAULT_FROM_NAME = env.fromName;
const BREVO_API_KEY = env.brevoApiKey; // API key from BREVO_API_KEY env var
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * Verify Brevo API connection
 */
async function verifyConnection() {
  try {
    if (!BREVO_API_KEY) {
      throw new Error('BREVO_API_KEY environment variable is not set');
    }
    console.log("✓ Brevo HTTP API configured successfully");
    return true;
  } catch (error) {
    console.error("✗ Brevo API configuration failed:", error.message);
    console.error("Check your environment variables:");
    console.error("- BREVO_API_KEY:", BREVO_API_KEY ? "set" : "NOT SET");
    console.error("- BREVO_FROM_EMAIL:", env.fromEmail || "NOT SET");
    return false;
  }
}

// Verify on startup
verifyConnection();

/**
 * Generic email sending function using Brevo HTTP API
 * @param {string} toEmail - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} htmlContent - HTML email content
 * @param {string} fromEmail - From email (optional, uses default)
 */
async function sendEmail(toEmail, subject, htmlContent, fromEmail = DEFAULT_FROM_EMAIL) {
  try {
    const payload = {
      to: [
        {
          email: toEmail,
        }
      ],
      sender: {
        email: fromEmail,
        name: DEFAULT_FROM_NAME,
      },
      subject,
      htmlContent,
    };

    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = errorData.message || `HTTP ${response.status}`;
      throw new Error(`Brevo API error: ${errorMessage}`);
    }

    const result = await response.json();
    console.log("✓ Email sent via Brevo API:", result.messageId);
    return result;
  } catch (error) {
    console.error("Error sending email via Brevo API:", error.message);
    throw error;
  }
}

module.exports = {
  sendEmail,
  verifyConnection,
};