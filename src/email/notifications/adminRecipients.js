function isValidEmail(value) {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

function parseRecipientList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => isValidEmail(item));
}

async function getAdminNotificationEmails(supabase) {
  const envRecipients = parseRecipientList(process.env.ADMIN_NOTIFICATION_EMAILS || process.env.ADMIN_EMAIL || '');

  const { data: admins, error } = await supabase
    .from('admins')
    .select('email, is_active')
    .eq('is_active', true);

  if (error) {
    if (envRecipients.length > 0) {
      return [...new Set(envRecipients)];
    }
    throw new Error(`Failed to fetch admin recipients: ${error.message}`);
  }

  const adminEmails = (admins || [])
    .map((admin) => admin.email)
    .filter((email) => isValidEmail(email));

  return [...new Set([...envRecipients, ...adminEmails])];
}

module.exports = {
  getAdminNotificationEmails
};
