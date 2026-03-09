const { sendEmail } = require('../brevo');

const STATUS_LABELS = {
  pending: 'En attente',
  confirmed: 'Confirmée',
  shipped: 'Expédiée',
  delivered: 'Livrée',
  cancelled: 'Annulée',
  paid: 'Payée'
};

const PAYMENT_METHOD_LABELS = {
  manual: 'Paiement manuel',
  moncash: 'MonCash',
  natcash: 'NatCash',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatAmount(amount) {
  const numeric = Number(amount ?? 0);
  return Number.isFinite(numeric) ? `${numeric.toFixed(2)} HTG` : '0.00 HTG';
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function paymentMethodLabel(method) {
  return PAYMENT_METHOD_LABELS[method] || method || 'N/A';
}

function buildTemplate({ title, intro, lines = [], ctaLabel, ctaUrl, footerNote }) {
  const rows = lines
    .map((line) => `<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#5c6370;">${line}</p>`)
    .join('');

  const cta = ctaLabel && ctaUrl
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;"><tr><td align="center"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:14px 32px;background-color:#7c3aed;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:6px;">${escapeHtml(ctaLabel)}</a></td></tr></table>`
    : '';

  const footer = footerNote
    ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#8b919d;text-align:center;">${footerNote}</p>`
    : '';

  return `<!DOCTYPE html>
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
          <tr>
            <td style="padding:32px 32px 24px;text-align:center;">
              <img src="https://tishop.co/logo.png" alt="TiShop" width="120" style="display:inline-block;" />
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#1a1d24;text-align:center;">${title}</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#5c6370;text-align:center;">${intro}</p>
              ${rows}
              ${cta}
              ${footer}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #ebebef;text-align:center;">
              <p style="margin:0;font-size:12px;color:#8b919d;">© 2026 TiShop · La plateforme de vente en ligne pour les vendeurs haïtiens</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendCustomerOrderPlacedEmail({
  toEmail, customerName, orderNumber, orderId, totalAmount, orderDate,
  sellerName, sellerLogoUrl, items = [], itemsSubtotal, deliveryFee
}) {
  const now = orderDate ? new Date(orderDate) : new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  const sellerHeader = sellerLogoUrl
    ? `<table cellpadding="0" cellspacing="0" style="margin:0 auto 20px;"><tr>
        <td style="width:48px;vertical-align:middle;"><img src="${escapeHtml(sellerLogoUrl)}" alt="${escapeHtml(sellerName || '')}" width="48" height="48" style="display:block;border-radius:50%;object-fit:cover;background-color:#ebebef;" /></td>
        <td style="padding-left:12px;vertical-align:middle;"><span style="font-size:16px;font-weight:600;color:#1a1d24;">${escapeHtml(sellerName || 'Boutique')}</span></td>
      </tr></table>`
    : `<p style="margin:0 0 20px;font-size:16px;font-weight:600;color:#1a1d24;text-align:center;">${escapeHtml(sellerName || 'Boutique')}</p>`;

  const itemRows = items.map(item => `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
      <tr>
        ${item.imageUrl ? `<td style="width:64px;vertical-align:top;"><img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.productName || '')}" width="64" height="64" style="display:block;object-fit:cover;border-radius:6px;background-color:#ebebef;" /></td>` : ''}
        <td style="${item.imageUrl ? 'padding-left:12px;' : ''}vertical-align:top;">
          <p style="margin:0 0 2px;font-size:13px;font-weight:600;color:#1a1d24;">${escapeHtml(item.productName || 'Produit')}${item.variant ? `<span style="color:#8b919d;font-weight:400;font-size:12px;"> · ${escapeHtml(item.variant)}</span>` : ''}</p>
          <p style="margin:0;font-size:12px;color:#8b919d;">${formatAmount(item.unitPrice)} × ${escapeHtml(String(item.quantity))}</p>
        </td>
        <td style="font-size:13px;font-weight:600;color:#1a1d24;text-align:right;vertical-align:top;white-space:nowrap;">${formatAmount(item.lineTotal)}</td>
      </tr>
    </table>`).join('');

  const html = `<!DOCTYPE html>
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
          <tr>
            <td style="padding:28px 32px 20px;text-align:center;">
              ${sellerHeader}
              <h1 style="margin:0 0 6px;font-size:22px;font-weight:600;color:#1a1d24;">Merci, ${escapeHtml(customerName || 'cher client')} ! 🛍️</h1>
              <p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:#5c6370;">Votre commande a été confirmée.</p>
              <p style="margin:0;font-size:13px;color:#8b919d;">Commande <strong style="color:#1a1d24;">${escapeHtml(orderNumber)}</strong> · ${escapeHtml(dateStr)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;">
              <div style="padding:14px 16px;background-color:#f8f8fa;border-radius:6px;margin-bottom:20px;">
                ${itemRows}
                <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #ebebef;padding-top:8px;margin-top:4px;">
                  <tr>
                    <td style="font-size:12px;color:#8b919d;padding:2px 0;">Sous-total</td>
                    <td style="font-size:12px;color:#5c6370;text-align:right;padding:2px 0;">${formatAmount(itemsSubtotal)}</td>
                  </tr>
                  <tr>
                    <td style="font-size:12px;color:#8b919d;padding:2px 0;">Livraison</td>
                    <td style="font-size:12px;color:#5c6370;text-align:right;padding:2px 0;">${formatAmount(deliveryFee)}</td>
                  </tr>
                </table>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="padding:12px 16px;background-color:#1a1d24;border-radius:6px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:15px;font-weight:600;color:#ffffff;">Total payé</td>
                        <td style="font-size:15px;font-weight:600;color:#ffffff;text-align:right;">${formatAmount(totalAmount)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="https://tishop.co/shop/orders/${escapeHtml(String(orderId || ''))}" style="display:inline-block;padding:14px 32px;background-color:#7c3aed;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:6px;">Suivre ma commande</a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#8b919d;text-align:center;">Vous recevrez une notification lorsque le vendeur aura confirmé votre commande.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #ebebef;text-align:center;">
              <p style="margin:0;font-size:12px;color:#8b919d;">© 2026 TiShop · La plateforme de vente en ligne pour les vendeurs haïtiens</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return sendEmail(toEmail, `Votre commande ${orderNumber} est confirmée`, html);
}

async function sendSellerNewOrderEmail({
  toEmail, sellerName, shopName, shopLogoUrl, orderNumber, customerName, customerPhone,
  sellerTotal, subtotal, deliveryFee, paymentMethod,
  items = [], deliveryAddress, orderDate
}) {
  const now = orderDate ? new Date(orderDate) : new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const itemCount = items.reduce((sum, i) => sum + (i.quantity || 0), 0);

  const productRows = items.map(item => `
          <tr>
            <td style="padding:0 32px 12px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ebebef;border-radius:6px;overflow:hidden;">
                <tr>
                  <td style="width:80px;vertical-align:top;">
                    ${item.imageUrl
                      ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.productName || '')}" width="80" height="80" style="display:block;object-fit:cover;background-color:#f8f8fa;" />`
                      : `<div style="width:80px;height:80px;background-color:#f8f8fa;"></div>`}
                  </td>
                  <td style="padding:10px 14px;vertical-align:top;">
                    <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#1a1d24;">${escapeHtml(item.productName || 'Produit')}</p>
                    ${item.variant ? `<p style="margin:0 0 4px;font-size:12px;color:#8b919d;">${escapeHtml(item.variant)}</p>` : ''}
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right:16px;">
                          <span style="font-size:12px;color:#8b919d;">Qté:</span>
                          <span style="font-size:13px;color:#1a1d24;font-weight:600;"> ${escapeHtml(String(item.quantity))}</span>
                        </td>
                        <td>
                          <span style="font-size:12px;color:#8b919d;">Prix:</span>
                          <span style="font-size:13px;color:#1a1d24;font-weight:600;"> ${formatAmount(item.unitPrice)}</span>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#7c3aed;">${formatAmount(item.lineTotal)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`).join('');

  const deliveryBlock = deliveryAddress ? `
          <tr>
            <td style="padding:0 32px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8f8fa;border-radius:6px;">
                <tr>
                  <td style="padding:12px 16px;">
                    <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#1a1d24;">📍 Livraison</p>
                    <p style="margin:0;font-size:13px;color:#5c6370;line-height:1.5;">${escapeHtml(deliveryAddress)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>` : '';

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f8f8fa;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8f8fa;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 20px;text-align:center;">
              ${shopLogoUrl
                ? `<img src="${escapeHtml(shopLogoUrl)}" alt="${escapeHtml(shopName || sellerName || '')}" width="64" height="64" style="display:block;margin:0 auto 12px;border-radius:50%;object-fit:cover;background-color:#ebebef;" />`
                : ''}
              <p style="margin:0 0 2px;font-size:13px;color:#8b919d;">Boutique</p>
              <h1 style="margin:0 0 4px;font-size:22px;font-weight:600;color:#1a1d24;">${escapeHtml(shopName || sellerName || 'Votre boutique')}</h1>
              <p style="margin:0;font-size:14px;line-height:1.6;color:#5c6370;">Nouvelle commande reçue</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8f8fa;border-radius:6px;">
                <tr>
                  <td style="padding:14px 16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:3px 0;font-size:13px;color:#8b919d;">Commande</td>
                        <td style="padding:3px 0;font-size:13px;color:#1a1d24;font-weight:600;text-align:right;">#${escapeHtml(orderNumber)}</td>
                      </tr>
                      <tr>
                        <td style="padding:3px 0;font-size:13px;color:#8b919d;">Date</td>
                        <td style="padding:3px 0;font-size:13px;color:#1a1d24;text-align:right;">${escapeHtml(dateStr)} à ${escapeHtml(timeStr)}</td>
                      </tr>
                      <tr>
                        <td style="padding:3px 0;font-size:13px;color:#8b919d;">Client</td>
                        <td style="padding:3px 0;font-size:13px;color:#1a1d24;text-align:right;">${escapeHtml(customerName || 'Client')}</td>
                      </tr>
                      <tr>
                        <td style="padding:3px 0;font-size:13px;color:#8b919d;">Téléphone</td>
                        <td style="padding:3px 0;font-size:13px;color:#1a1d24;text-align:right;">${escapeHtml(customerPhone || 'N/A')}</td>
                      </tr>
                      ${paymentMethod !== 'manual' ? `<tr>
                        <td style="padding:3px 0;font-size:13px;color:#8b919d;">Paiement</td>
                        <td style="padding:3px 0;font-size:13px;text-align:right;">
                          <span style="display:inline-block;padding:2px 10px;background-color:#f3f0ff;color:#7c3aed;border-radius:12px;font-weight:600;font-size:12px;">${escapeHtml(paymentMethodLabel(paymentMethod))}</span>
                        </td>
                      </tr>` : ''}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 8px;">
              <p style="margin:0;font-size:14px;font-weight:600;color:#1a1d24;">Articles commandés</p>
            </td>
          </tr>
          ${productRows}
          <tr>
            <td style="padding:8px 32px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #ebebef;padding-top:12px;">
                <tr>
                  <td style="padding:4px 0;font-size:13px;color:#8b919d;">Sous-total</td>
                  <td style="padding:4px 0;font-size:13px;color:#1a1d24;text-align:right;">${formatAmount(subtotal)}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:13px;color:#8b919d;">Frais de livraison</td>
                  <td style="padding:4px 0;font-size:13px;color:#1a1d24;text-align:right;">${formatAmount(deliveryFee)}</td>
                </tr>
                <tr>
                  <td colspan="2" style="padding:8px 0 0;border-top:1px solid #ebebef;"></td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:16px;color:#1a1d24;font-weight:600;">Total</td>
                  <td style="padding:4px 0;font-size:16px;color:#1a1d24;font-weight:600;text-align:right;">${formatAmount(sellerTotal)}</td>
                </tr>
              </table>
            </td>
          </tr>
          ${deliveryBlock}
          <tr>
            <td style="padding:0 32px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="https://seller.tishop.co/dashboard/orders" style="display:inline-block;padding:14px 32px;background-color:#7c3aed;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:6px;">Voir la commande</a>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#8b919d;text-align:center;">Vérifiez le paiement et préparez la commande dès que possible.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #ebebef;text-align:center;">
              <p style="margin:0;font-size:12px;color:#8b919d;">© 2026 TiShop · La plateforme de vente en ligne pour les vendeurs haïtiens</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return sendEmail(toEmail, `Nouvelle commande #${orderNumber} — ${itemCount} article${itemCount > 1 ? 's' : ''}`, html);
}

async function sendAdminNewOrderEmail({ toEmail, orderNumber, customerName, totalAmount, paymentMethod }) {
  const html = buildTemplate({
    title: 'Nouvelle commande à vérifier',
    intro: 'Une nouvelle commande vient d’être enregistrée et requiert un suivi administratif.',
    lines: [
      `Commande : <strong>${escapeHtml(orderNumber)}</strong>`,
      `Client : <strong>${escapeHtml(customerName || 'N/A')}</strong>`,
      `Total : <strong>${formatAmount(totalAmount)}</strong>`,
      `Paiement : <strong>${escapeHtml(paymentMethodLabel(paymentMethod))}</strong>`
    ],
    ctaLabel: 'Ouvrir le panneau admin',
    ctaUrl: 'https://admin.tishop.co/panel/orders'
  });

  return sendEmail(toEmail, `Admin: nouvelle commande #${orderNumber}`, html);
}

async function sendCustomerOrderPaidEmail({ toEmail, customerName, orderNumber, totalAmount, deliveryCodes = [] }) {
  const lines = [
    `Commande : <strong>${escapeHtml(orderNumber)}</strong>`,
    `Montant : <strong>${formatAmount(totalAmount)}</strong>`,
    `Statut : <strong>${statusLabel('paid')}</strong>`
  ];

  if (deliveryCodes.length > 0) {
    lines.push('');
    lines.push('<strong>Vos codes de livraison :</strong>');
    for (const entry of deliveryCodes) {
      lines.push(`🔑 <strong>${escapeHtml(entry.shopName)}</strong> — Code : <strong>${escapeHtml(entry.code)}</strong>`);
    }
    lines.push('Présentez ce code au livreur pour récupérer votre commande.');
  }

  const html = buildTemplate({
    title: 'Paiement confirmé',
    intro: `Bonjour ${escapeHtml(customerName || 'cher client')}, le paiement de votre commande a été validé.`,
    lines,
    ctaLabel: 'Suivre ma commande',
    ctaUrl: 'https://tishop.co/shop/order-confirmation'
  });

  return sendEmail(toEmail, `Paiement confirmé #${orderNumber}`, html);
}

async function sendSellerOrderPaidEmail({ toEmail, sellerName, orderNumber, sellerTotal }) {
  const html = buildTemplate({
    title: 'Commande payée',
    intro: `Bonjour ${escapeHtml(sellerName || 'vendeur')}, le paiement de votre commande vendeur est confirmé.`,
    lines: [
      `Commande : <strong>${escapeHtml(orderNumber)}</strong>`,
      `Montant vendeur : <strong>${formatAmount(sellerTotal)}</strong>`,
      `Vous pouvez préparer l’expédition.`
    ],
    ctaLabel: 'Gérer la commande',
    ctaUrl: 'https://seller.tishop.co/dashboard/orders'
  });

  return sendEmail(toEmail, `Commande payée #${orderNumber}`, html);
}

async function sendCustomerOrderStatusEmail({ toEmail, customerName, orderNumber, status, sellerName }) {
  const html = buildTemplate({
    title: 'Mise à jour de commande',
    intro: `Bonjour ${escapeHtml(customerName || 'cher client')}, le vendeur a mis à jour votre commande.`,
    lines: [
      `Commande : <strong>${escapeHtml(orderNumber)}</strong>`,
      `Vendeur : <strong>${escapeHtml(sellerName || 'Boutique')}</strong>`,
      `Nouveau statut : <strong>${escapeHtml(statusLabel(status))}</strong>`
    ],
    ctaLabel: 'Voir le détail',
    ctaUrl: 'https://tishop.co/shop/order-confirmation'
  });

  return sendEmail(toEmail, `Commande #${orderNumber} · ${statusLabel(status)}`, html);
}

async function sendSellerPayoutRequestedEmail({ toEmail, sellerName, amount, payoutMethod }) {
  const html = buildTemplate({
    title: 'Demande de retrait reçue',
    intro: `Bonjour ${escapeHtml(sellerName || 'vendeur')}, votre demande de retrait a bien été enregistrée.`,
    lines: [
      `Montant : <strong>${formatAmount(amount)}</strong>`,
      `Méthode : <strong>${escapeHtml(payoutMethod || 'N/A')}</strong>`,
      'Notre équipe va traiter votre demande sous peu.'
    ],
    ctaLabel: 'Voir mes paiements',
    ctaUrl: 'https://seller.tishop.co/dashboard/payouts'
  });

  return sendEmail(toEmail, 'Demande de retrait enregistrée', html);
}

async function sendAdminPayoutRequestedEmail({ toEmail, sellerName, sellerEmail, amount, payoutMethod, payoutId }) {
  const html = buildTemplate({
    title: 'Nouvelle demande de retrait',
    intro: 'Un vendeur a soumis une nouvelle demande de retrait.',
    lines: [
      `Vendeur : <strong>${escapeHtml(sellerName || 'N/A')}</strong>`,
      `Email vendeur : <strong>${escapeHtml(sellerEmail || 'N/A')}</strong>`,
      `Montant : <strong>${formatAmount(amount)}</strong>`,
      `Méthode : <strong>${escapeHtml(payoutMethod || 'N/A')}</strong>`,
      `ID retrait : <strong>${escapeHtml(payoutId || 'N/A')}</strong>`
    ],
    ctaLabel: 'Ouvrir le panneau admin',
    ctaUrl: 'https://admin.tishop.co/panel/payouts'
  });

  return sendEmail(toEmail, `Admin: demande de retrait ${payoutId || ''}`.trim(), html);
}

module.exports = {
  sendCustomerOrderPlacedEmail,
  sendSellerNewOrderEmail,
  sendAdminNewOrderEmail,
  sendCustomerOrderPaidEmail,
  sendSellerOrderPaidEmail,
  sendCustomerOrderStatusEmail,
  sendSellerPayoutRequestedEmail,
  sendAdminPayoutRequestedEmail,
  statusLabel
};
