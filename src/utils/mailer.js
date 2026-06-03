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
    subject: 'Password Reset — Quoridor',
    html: `<p>You requested a password reset.</p><p>Click <a href="${link}">here</a> to reset your password. This link expires in 1 hour.</p><p>If you did not request this, ignore this email.</p>`
  });
  if (error) {
    console.error('[MAILER] Send error:', error);
  }
  return data;
}

module.exports = { sendPasswordResetEmail };
