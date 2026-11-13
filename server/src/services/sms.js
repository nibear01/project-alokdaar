/**
 * SMS wrapper (ARCHITECTURE §5.7): BulkSMSBD or Twilio behind one boundary with
 * timeouts. Dev fallback (no provider configured): log + report skipped, so every
 * caller can run without gateway credentials.
 */

export function isConfigured() {
  const p = (process.env.SMS_PROVIDER || '').toLowerCase();
  if (p === 'bulksmsbd') {
    return Boolean(process.env.BULKSMSBD_API_KEY && process.env.BULKSMSBD_SENDER_ID);
  }
  if (p === 'twilio') {
    return Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_FROM_NUMBER,
    );
  }
  return false;
}

/** Normalize Bangladeshi numbers to 8801XXXXXXXXX; leaves other formats as digits. */
export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  if (digits.startsWith('8801') && digits.length === 13) return digits;
  if (digits.startsWith('01') && digits.length === 11) return `88${digits}`;
  if (digits.startsWith('1') && digits.length === 10) return `880${digits}`;
  return digits;
}

/** True when two raw numbers refer to the same subscriber (compare last 10 digits). */
export function samePhone(a, b) {
  const ta = normalizePhone(a).slice(-10);
  const tb = normalizePhone(b).slice(-10);
  return ta.length === 10 && ta === tb;
}

async function sendBulkSmsBd(to, body) {
  const url = new URL('http://bulksmsbd.net/api/smsapi');
  url.searchParams.set('api_key', process.env.BULKSMSBD_API_KEY);
  url.searchParams.set('type', 'text');
  url.searchParams.set('senderid', process.env.BULKSMSBD_SENDER_ID);
  url.searchParams.set('number', to);
  url.searchParams.set('message', body);
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`BulkSMSBD HTTP ${res.status}`);
  return { provider: 'bulksmsbd', response: await res.text() };
}

async function sendTwilio(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: `+${normalizePhone(to)}`,
      From: process.env.TWILIO_FROM_NUMBER,
      Body: body,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Twilio HTTP ${res.status}`);
  return { provider: 'twilio', response: await res.json() };
}

/**
 * Send one SMS. Never throws — returns { sent } | { skipped } | { failed }.
 * @returns {Promise<{sent?: true, skipped?: true, failed?: true, error?: string}>}
 */
export async function send({ to, body }) {
  const number = normalizePhone(to);
  if (!number) return { skipped: true, error: 'no phone number' };
  if (!isConfigured()) {
    console.log(`[sms:dev] to=${number} body="${body}"`);
    return { skipped: true };
  }
  try {
    const p = (process.env.SMS_PROVIDER || '').toLowerCase();
    if (p === 'bulksmsbd') await sendBulkSmsBd(number, body);
    else await sendTwilio(number, body);
    return { sent: true };
  } catch (err) {
    console.error('[sms] send failed:', err.message);
    return { failed: true, error: err.message };
  }
}
