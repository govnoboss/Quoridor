const { URL } = require('node:url');
let resend = null;

function getResend() {
  if (!resend) {
    const { Resend } = require('resend');
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn('[MAILER] RESEND_API_KEY not set. Password reset emails will not be sent.');
      return null;
    }
    resend = new Resend(apiKey);
  }
  return resend;
}

async function sendPasswordResetEmail(to, token) {
  const r = getResend();
  if (!r) return;

  const link = `${process.env.SITE_URL || 'https://playquor.org'}/reset-password?token=${token}`;
  const { data, error } = await r.emails.send({
    from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
    to,
    subject: 'Password Reset — PlayQuor',
    html: `<p>You requested a password reset.</p><p>Click <a href="${link}">here</a> to reset your password. This link expires in 1 hour.</p><p>If you did not request this, ignore this email.</p>`
  });
  if (error) {
    console.error('[MAILER] Send error:', error);
  }
  return data;
}

async function sendSupportReplyEmail(to, reportId, notificationId) {
  const r = getResend();
  if (!r || !process.env.EMAIL_FROM) throw new Error('Support email is not configured');
  const origin = new URL(process.env.SITE_URL || 'https://playquor.org').origin;
  const link = `${origin}/profile/reports?report=${encodeURIComponent(reportId)}`;
  let timeout;
  const { data, error } = await Promise.race([r.emails.send({
    from: process.env.EMAIL_FROM,
    to,
    subject: 'Support replied — PlayQuor',
    text: `There is a new reply to your support report. Sign in to read it: ${link}\nYou can disable these emails in the notification centre on PlayQuor.`
  }, { idempotencyKey: `support-notification/${notificationId}` }), new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Support email timed out')), 15000);
  })]).finally(() => clearTimeout(timeout));
  if (error) throw new Error('Support email delivery failed');
  return data;
}

module.exports = { sendPasswordResetEmail, sendSupportReplyEmail };
