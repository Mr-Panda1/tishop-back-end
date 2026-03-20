const { sendEmail } = require("../brevo");

// ─── Approval ────────────────────────────────────────────────────────────────

const kycApprovalTemplate = (sellerName) => `<!DOCTYPE html>
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
          <!-- Badge -->
          <tr>
            <td style="padding:0 32px 8px;text-align:center;">
              <span style="display:inline-block;padding:6px 16px;background-color:#ecfdf5;color:#059669;font-size:13px;font-weight:600;border-radius:20px;">
                ✓ Compte vérifié
              </span>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:16px 32px 32px;">
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:600;color:#1a1d24;text-align:center;">
                Votre vérification KYC est approuvée !
              </h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#5c6370;text-align:center;">
                Bonjour ${sellerName},
              </p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#5c6370;text-align:center;">
                Bonne nouvelle ! Votre dossier de vérification d'identité (KYC) a été examiné et <strong style="color:#059669;">approuvé</strong>. Votre compte vendeur est désormais entièrement activé.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#5c6370;text-align:center;">
                Vous pouvez maintenant publier vos produits, recevoir des commandes et accéder à toutes les fonctionnalités de la plateforme.
              </p>
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="https://seller.tishop.co/dashboard" style="display:inline-block;padding:14px 32px;background-color:#7c3aed;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:6px;">
                      Accéder à mon tableau de bord
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#8b919d;text-align:center;">
                Besoin d'aide ? Contactez notre équipe support à tout moment.
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

// ─── Rejection ────────────────────────────────────────────────────────────────

const kycRejectionTemplate = (sellerName, rejectionReason) => `<!DOCTYPE html>
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
          <!-- Badge -->
          <tr>
            <td style="padding:0 32px 8px;text-align:center;">
              <span style="display:inline-block;padding:6px 16px;background-color:#fef2f2;color:#dc2626;font-size:13px;font-weight:600;border-radius:20px;">
                Vérification refusée
              </span>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:16px 32px 32px;">
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:600;color:#1a1d24;text-align:center;">
                Votre dossier KYC n'a pas été accepté
              </h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#5c6370;text-align:center;">
                Bonjour ${sellerName},
              </p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#5c6370;text-align:center;">
                Après examen de votre dossier de vérification d'identité (KYC), notre équipe n'a pas pu l'approuver pour la raison suivante :
              </p>
              <!-- Reason box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="padding:16px;background-color:#fef2f2;border-left:4px solid #dc2626;border-radius:4px;font-size:14px;line-height:1.6;color:#7f1d1d;">
                    ${rejectionReason}
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#5c6370;text-align:center;">
                Vous pouvez corriger les informations concernées et soumettre à nouveau votre dossier depuis votre tableau de bord.
              </p>
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="https://seller.tishop.co/dashboard" style="display:inline-block;padding:14px 32px;background-color:#7c3aed;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:6px;">
                      Soumettre à nouveau mon dossier
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#8b919d;text-align:center;">
                Besoin d'aide ? Contactez notre équipe support à tout moment.
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

// ─── Exports ──────────────────────────────────────────────────────────────────

async function sendKycApprovalEmail(toEmail, sellerName) {
  return await sendEmail(
    toEmail,
    "Votre vérification KYC est approuvée ✓",
    kycApprovalTemplate(sellerName)
  );
}

async function sendKycRejectionEmail(toEmail, sellerName, rejectionReason) {
  return await sendEmail(
    toEmail,
    "Mise à jour de votre dossier KYC - Action requise",
    kycRejectionTemplate(sellerName, rejectionReason)
  );
}

module.exports = {
  sendKycApprovalEmail,
  sendKycRejectionEmail,
};
