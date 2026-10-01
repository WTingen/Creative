import type { APIRoute } from 'astro';
import { insertMessage } from '../../lib/db';
import { sendConfirmationEmail } from '../../lib/email';
import { logContactMessage } from '../../lib/sheets';
import { EMAIL_USER, EMAIL_DOMAIN } from '../../lib/contact';
import { checkSubmission, guardRejection, escapeHtml, json } from '../../lib/spamGuard';

// On-demand route, same reasoning as /api/subscribe — it has to run
// server-side to write to the database.
export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 120;
const MAX_EMAIL = 254;
const MAX_MESSAGE = 5000;

// The bot hitting this form in Sept 2026 sent one unbroken run of random
// mixed-case letters ("XZGYBDnPqPbFYUIlAofwMcH"). Real messages have spaces.
function looksLikeGibberish(message: string) {
  return !/\s/.test(message) && message.length >= 12 && /[a-z][A-Z]/.test(message);
}

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid request body' }, 400);
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  if (!name || !EMAIL_RE.test(email) || !message) {
    return json({ success: false, error: 'Fill in your name, a valid email, and a message.' }, 400);
  }
  if (name.length > MAX_NAME || email.length > MAX_EMAIL || message.length > MAX_MESSAGE) {
    return json({ success: false, error: 'That message is too long — trim it down and try again.' }, 400);
  }

  const guard = await checkSubmission(request, body);
  if (!guard.ok) return guardRejection(guard, '/api/contact');
  if (looksLikeGibberish(message)) {
    return guardRejection({ ok: false, silent: true, reason: 'gibberish message' }, '/api/contact');
  }

  try {
    insertMessage({ name, email, message });
  } catch (err) {
    console.error('Failed to save message:', err);
    return json({ success: false, error: 'Something went wrong. Try again.' }, 500);
  }

  // Best-effort notification to Warren — the message is already saved above
  // even if the send fails. There's deliberately no auto-reply to the
  // submitter: emailing arbitrary addresses is exactly what spam bots abuse
  // this form for, and Warren replies personally anyway.
  await sendConfirmationEmail({
    to: `${EMAIL_USER}@${EMAIL_DOMAIN}`,
    subject: `New message from ${name.replace(/[\r\n]+/g, ' ')} (site contact form)`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <p><strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}) sent this from the contact form:</p>
        <p style="white-space: pre-wrap; border-left: 3px solid #F15A29; padding-left: 12px;">${escapeHtml(message)}</p>
      </div>
    `,
  });

  // Best-effort row in the Google Sheet Warren tracks leads in — never
  // blocks or fails the response if Sheets access isn't configured.
  const sheetResult = await logContactMessage({ name, email, message });
  if (!sheetResult.ok) console.error('Failed to log contact message to Sheets:', sheetResult.reason);

  return json({ success: true });
};
