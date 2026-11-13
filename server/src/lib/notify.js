/**
 * Notification fan-out (ARCHITECTURE 5.7): in-app always; email via SendGrid
 * when configured; sms recorded as intent until a gateway is wired.
 */
export async function notify(client, { userId, applicationId = null, interviewId = null, kind, title, body }) {
  const insert = (channel, status) =>
    client.query(
      `INSERT INTO notifications (user_id, application_id, interview_id, kind, channel, title, body, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, applicationId, interviewId, kind, channel, title ?? null, body ?? null, status],
    );

  await insert('in_app', 'sent');

  const hasSendGrid = Boolean(process.env.SENDGRID_API_KEY);
  await insert('email', hasSendGrid ? 'pending' : 'skipped');
  await insert('sms', 'skipped');

  if (hasSendGrid) {
    const mark = async (status) =>
      client.query(
        `UPDATE notifications SET status = $1
         WHERE user_id = $2 AND kind = $3 AND COALESCE(interview_id, 0) = COALESCE($4, 0)
           AND channel = 'email'`,
        [status, userId, kind, interviewId],
      );
    try {
      const sg = (await import('@sendgrid/mail')).default;
      sg.setApiKey(process.env.SENDGRID_API_KEY);
      await sg.send({
        to: process.env.NOTIFY_EMAIL_FALLBACK || 'dev@alokdaar.local',
        from: process.env.FROM_EMAIL || 'noreply@alokdaar.local',
        subject: title,
        text: body,
      });
      await mark('sent');
    } catch {
      await mark('failed');
    }
  }
}
