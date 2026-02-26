const { sendEmail } = require("../brevo");

const orderConfirmationTemplate = `
<!DOCTYPE html>
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
                Merci, {{customer_name}}! 🛍️
              </h1>
              <p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:#5c6370;text-align:center;">
                Votre commande a été confirmée.
              </p>
              <p style="margin:0 0 24px;font-size:13px;color:#8b919d;text-align:center;">
                Commande <strong style="color:#1a1d24;">{{order_number}}</strong> · {{order_date}}
              </p>

              <!-- ===== REPEAT PER SELLER GROUP ===== -->
              <!-- {{#each seller_groups}} -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                <tr>
                  <td style="padding:12px 16px;background-color:#f8f8fa;border-radius:6px;">
                    <!-- Seller header -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
                      <tr>
                        <td style="font-size:13px;font-weight:600;color:#1a1d24;padding-bottom:8px;border-bottom:1px solid #ebebef;">
                          🏪 {{seller_name}}
                        </td>
                      </tr>
                    </table>

                    <!-- Items -->
                    <!-- {{#each items}} -->
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;">
                          <table width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="font-size:13px;color:#1a1d24;">
                                {{product_name}}
                                <!-- {{#if variant}} -->
                                <span style="color:#8b919d;font-size:12px;"> · {{variant}}</span>
                                <!-- {{/if}} -->
                              </td>
                              <td style="font-size:13px;color:#1a1d24;text-align:right;white-space:nowrap;">
                                {{line_total}} HTG
                              </td>
                            </tr>
                            <tr>
                              <td colspan="2" style="font-size:11px;color:#8b919d;padding-top:1px;">
                                {{unit_price}} HTG × {{quantity}}
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                    <!-- {{/each}} -->

                    <!-- Seller subtotals -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border-top:1px solid #ebebef;padding-top:8px;">
                      <tr>
                        <td style="font-size:12px;color:#8b919d;padding:2px 0;">Sous-total</td>
                        <td style="font-size:12px;color:#5c6370;text-align:right;padding:2px 0;">{{items_subtotal}} HTG</td>
                      </tr>
                      <tr>
                        <td style="font-size:12px;color:#8b919d;padding:2px 0;">Livraison</td>
                        <td style="font-size:12px;color:#5c6370;text-align:right;padding:2px 0;">{{delivery_fee}} HTG</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- {{/each}} -->

              <!-- Grand Total -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="padding:12px 16px;background-color:#1a1d24;border-radius:6px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:15px;font-weight:600;color:#ffffff;">Total payé</td>
                        <td style="font-size:15px;font-weight:600;color:#ffffff;text-align:right;">{{total_amount}} HTG</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="https://tishop.co/shop/orders/{{order_id}}" style="display:inline-block;padding:14px 32px;background-color:#7c3aed;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:6px;">
                      Suivre ma commande
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#8b919d;text-align:center;">
                Vous recevrez une notification lorsque chaque vendeur aura confirmé vos articles.
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
 * Send order confirmation email to customer
 * @param {string} toEmail - Customer's email address
 * @param {string} orderNumber - Order number (optional)
 */
async function sendOrderConfirmationEmail(toEmail, orderNumber = "") {
  return await sendEmail(toEmail, "Confirmation de commande #" + orderNumber, orderConfirmationTemplate);
}

module.exports = {
  sendOrderConfirmationEmail,
  orderConfirmationTemplate,
};
