const { sendEmail } = require("../brevo");

const welcomeEmailTemplate = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f8f8fa;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8f8fa;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <!-- Logo -->
          <tr>
            <td style="padding:32px 32px 24px;text-align:center;">
              <img src="https://tishop.co/logo.png" alt="TiShop" width="120" style="display:inline-block;" />
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:0 32px 32px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#1a1d24;text-align:center;">
                Bienvenue sur TiShop! 🎉
              </h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#5c6370;text-align:center;">
                Votre compte vendeur a été créé avec succès. Vous pouvez maintenant ajouter vos produits, gérer vos commandes et commencer à vendre en ligne.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#5c6370;text-align:center;">
                Connectez-vous à votre tableau de bord pour configurer votre boutique et publier vos premiers produits.
              </p>
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="https://seller.tishop.co/login" style="display:inline-block;padding:14px 32px;background-color:#7c3aed;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:6px;">
                      Accéder à mon tableau de bord
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#8b919d;text-align:center;">
                Besoin d'aide? Contactez notre équipe support à tout moment.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #ebebef;text-align:center;">
              <p style="margin:0;font-size:12px;color:#8b919d;">
                © 2026 TiShop · La plateforme de vente en ligne pour les vendeurs haïtiens
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

/**
 * Send welcome email to new seller
 * @param {string} toEmail - Seller's email address
 * @param {string} sellerName - Seller's name (optional)
 */
async function sendWelcomeEmail(toEmail, sellerName = "Seller") {
  return await sendEmail(toEmail, "Bienvenue sur TiShop! 🎉", welcomeEmailTemplate);
}

module.exports = {
  sendWelcomeEmail,
  welcomeEmailTemplate,
};