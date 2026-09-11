import { Resend } from 'resend';

// Reads at call time (not module load) so a missing key never crashes the
// build — it just means confirmation emails are skipped until it's set.
function getResendClient() {
  const apiKey = import.meta.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

const FROM_ADDRESS = import.meta.env.RESEND_FROM_EMAIL || 'Tingen Creative <warren@tingencreative.com>';

interface ConfirmationEmail {
  to: string;
  subject: string;
  html: string;
}

/**
 * Sends a confirmation email via Resend. Returns { sent: false, reason }
 * instead of throwing when Resend isn't configured yet or the send fails,
 * so a lead is never lost just because email delivery had a problem — it's
 * already saved to the database by the time this runs.
 */
export async function sendConfirmationEmail({ to, subject, html }: ConfirmationEmail) {
  const resend = getResendClient();
  if (!resend) {
    return { sent: false, reason: 'RESEND_API_KEY not configured' };
  }
  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
    });
    if (error) {
      return { sent: false, reason: error.message };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : 'Unknown error' };
  }
}
