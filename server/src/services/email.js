import sgMail from '@sendgrid/mail';

const OTP_TEMPLATE = (otp, name) => ({
  subject: 'Your Alokdaar verification code',
  text: `Hi ${name || ''},\n\nYour verification code is: ${otp}\n\nIt expires in 10 minutes. If you did not request this, ignore this email.\n\n— Alokdaar`,
  html: `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;background:#F6F3EA;border-radius:12px">
      <h2 style="color:#1F2A22;margin:0 0 8px">Alokdaar</h2>
      <p style="color:#1F2A22">Hi ${name || ''},</p>
      <p style="color:#1F2A22">Your verification code is:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:700;color:#1F2A22;background:#fff;padding:16px;text-align:center;border-radius:8px">${otp}</p>
      <p style="color:#555;font-size:14px">Expires in 10 minutes. If you did not request this, ignore this email.</p>
      <p style="color:#888;font-size:12px">— Alokdaar · Education aid, made transparent.</p>
    </div>`,
});

/**
 * Send OTP email. Falls back to console log when SENDGRID_API_KEY is empty
 * so local dev works without credentials.
 */
export async function sendOtpEmail({ to, name, otp }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL;

  if (!apiKey || !from) {
    console.log(`[email] SENDGRID not configured — OTP for ${to}: ${otp}`);
    return { delivered: false, mode: 'console' };
  }

  sgMail.setApiKey(apiKey);
  const { subject, text, html } = OTP_TEMPLATE(otp, name);
  await sgMail.send({ to, from, subject, text, html });
  return { delivered: true, mode: 'sendgrid' };
}
