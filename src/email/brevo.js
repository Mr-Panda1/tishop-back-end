const env = require('../db/env');
const nodemailer = require("nodemailer");
// Initialize Brevo transporter
const transporter = nodemailer.createTransport({
  host: env.host,
  port: env.port,
  secure: false,
  auth: {
    user: env.user,
    pass: env.pass,
  },
  connectionTimeout: 10000, // 10 seconds
  socketTimeout: 10000, // 10 seconds
});

const DEFAULT_FROM_EMAIL = env.fromEmail;
const DEFAULT_FROM_NAME = env.fromName;

/**
 * Verify Brevo connection
 */
async function verifyConnection() {
  try {
    await transporter.verify();
    console.log("✓ Brevo SMTP connection verified successfully");
    return true;
  } catch (error) {
    console.error("✗ Brevo connection failed:", error.message);
    console.error("Check your environment variables:");
    console.error("- BREVO_EMAIL_USER:", env.user ? "set" : "NOT SET");
    console.error("- BREVO_EMAIL_PASS:", env.pass ? "set" : "NOT SET");
    return false;
  }
}

// Verify connection on startup
verifyConnection();

/**
 * Generic email sending function
 * @param {string} toEmail - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} htmlContent - HTML email content
 * @param {string} fromEmail - From email (optional, uses default)
 */
async function sendEmail(toEmail, subject, htmlContent, fromEmail = DEFAULT_FROM_EMAIL) {
  try {
    const mailOptions = {
      from: `"${DEFAULT_FROM_NAME}" <${fromEmail}>`,
      to: toEmail,
      subject,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent:", info.messageId);
    return info;
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
}

module.exports = {
  sendEmail,
  verifyConnection,
  transporter,
};