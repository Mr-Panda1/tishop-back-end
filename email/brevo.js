const nodemailer = require("nodemailer");

// Initialize Brevo transporter
const transporter = nodemailer.createTransport({
  host: process.env.BREVO_SMTP_HOST || "smtp-relay.brevo.com",
  port: process.env.BREVO_SMTP_PORT || 587,
  secure: process.env.BREVO_SECURE === "true", // false for 587
  auth: {
    user: process.env.BREVO_EMAIL_USER,
    pass: process.env.BREVO_EMAIL_PASS,
  },
});

const DEFAULT_FROM_EMAIL = process.env.BREVO_FROM_EMAIL || "no-reply@tishop.co";
const DEFAULT_FROM_NAME = "TiShop";

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
  transporter,
};