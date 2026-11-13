import * as sms from '../services/sms.js';

/**
 * Notification fan-out (ARCHITECTURE §5.7): in-app always; email (SendGrid REST)
 * and SMS (BulkSMSBD/Twilio) honour the user's notification_preferences and are
 * skipped when the gateway is unconfigured. External sends carry timeouts so a
 * caller's transaction can never hang on a slow gateway.
 *
 * Options: `dedupHours` — skip entirely when the same (user, kind) was already
 * notified inside the window (used by scheduled reminder jobs).
 */
export async function notify(
  client,
  { userId, applicationId = null, interviewId = null, kind, title, body, dedupHours = 0 },
) {
  if (dedupHours > 0) {
    const { rows } = await client.query(
      `SELECT 1 FROM notifications
       WHERE user_id = $1 AND kind = $2 AND created_at > now() - ($3 || ' hours')::interval
       LIMIT 1`,
      [userId, kind, dedupHours],
    );
    if (rows.length) return { deduped: true };
  }

  const { rows: users } = await client.query(
    `SELECT u.email, u.phone, u.name,
            COALESCE(p.email_enabled, TRUE) AS email_enabled,
            COALESCE(p.sms_enabled, TRUE) AS sms_enabled
     FROM users u
     LEFT JOIN notification_preferences p ON p.user_id = u.id
     WHERE u.id = $1`,
    [userId],
  );
  const user = users[0];
  if (!user) return { skipped: true, error: 'user not found' };

  const insert = (channel, status) =>
    client.query(
      `INSERT INTO notifications (user_id, application_id, interview_id, kind, channel, title, body, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, applicationId, interviewId, kind, channel, title ?? null, body ?? null, status],
    );

  await insert('in_app', 'sent');

  // email — SendGrid REST v3 with timeout; no SDK import inside the transaction
  let emailStatus = 'skipped';
  if (!user.email_enabled) emailStatus = 'skipped';
  else if (process.env.SENDGRID_API_KEY && user.email) {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: user.email, name: user.name }] }],
          from: {
            email:
              process.env.SENDGRID_FROM_EMAIL ||
              process.env.FROM_EMAIL ||
              'noreply@alokdaar.local',
            name: process.env.APP_NAME || 'Alokdaar',
          },
          subject: title || 'Alokdaar update',
          content: [{ type: 'text/plain', value: body || title || '' }],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      emailStatus = res.ok || res.status === 202 ? 'sent' : 'failed';
    } catch {
      emailStatus = 'failed';
    }
  }
  await insert('email', emailStatus);

  // sms — wrapper never throws
  let smsStatus = 'skipped';
  if (user.sms_enabled && user.phone) {
    const r = await sms.send({ to: user.phone, body: `${title ? `${title}: ` : ''}${body || ''}`.slice(0, 320) });
    smsStatus = r.sent ? 'sent' : r.failed ? 'failed' : 'skipped';
  }
  await insert('sms', smsStatus);

  return { in_app: 'sent', email: emailStatus, sms: smsStatus };
}
