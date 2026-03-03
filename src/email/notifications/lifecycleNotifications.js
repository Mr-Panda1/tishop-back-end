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
  moncash: 'MonCash'
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

async function sendCustomerOrderPlacedEmail({ toEmail, customerName, orderNumber, totalAmount, paymentMethod }) {
  const html = buildTemplate({
    title: `Commande reçue #${orderNumber}`,
    intro: `Merci ${escapeHtml(customerName || 'cher client')} ! Nous avons bien reçu votre commande.`,
    lines: [
      `Numéro de commande : <strong>${escapeHtml(orderNumber)}</strong>`,
      `Montant total : <strong>${formatAmount(totalAmount)}</strong>`,
      `Mode de paiement : <strong>${escapeHtml(paymentMethodLabel(paymentMethod))}</strong>`
    ],
    ctaLabel: 'Voir mes commandes',
    ctaUrl: `https://tishop.co/shop/order-confirmation?orderNumber=${encodeURIComponent(orderNumber || '')}`,
    footerNote: 'Nous vous notifierons dès que le paiement est validé et que la commande évolue.'
  });

  return sendEmail(toEmail, `Commande reçue #${orderNumber}`, html);
}

async function sendSellerNewOrderEmail({ toEmail, sellerName, orderNumber, customerName, sellerTotal, paymentMethod }) {
  const html = buildTemplate({
    title: 'Nouvelle commande reçue',
    intro: `Bonjour ${escapeHtml(sellerName || 'vendeur')}, une nouvelle commande est arrivée dans votre boutique.`,
    lines: [
      `Commande : <strong>${escapeHtml(orderNumber)}</strong>`,
      `Client : <strong>${escapeHtml(customerName || 'Client')}</strong>`,
      `Montant de votre commande vendeur : <strong>${formatAmount(sellerTotal)}</strong>`,
      `Paiement : <strong>${escapeHtml(paymentMethodLabel(paymentMethod))}</strong>`
    ],
    ctaLabel: 'Voir les commandes',
    ctaUrl: 'https://seller.tishop.co/dashboard/orders'
  });

  return sendEmail(toEmail, `Nouvelle commande #${orderNumber}`, html);
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

async function sendCustomerOrderPaidEmail({ toEmail, customerName, orderNumber, totalAmount }) {
  const html = buildTemplate({
    title: 'Paiement confirmé',
    intro: `Bonjour ${escapeHtml(customerName || 'cher client')}, le paiement de votre commande a été validé.`,
    lines: [
      `Commande : <strong>${escapeHtml(orderNumber)}</strong>`,
      `Montant : <strong>${formatAmount(totalAmount)}</strong>`,
      `Statut : <strong>${statusLabel('paid')}</strong>`
    ],
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
