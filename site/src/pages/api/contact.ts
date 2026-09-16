import type { APIRoute } from 'astro';
import { insertMessage } from '../../lib/db';
import { sendConfirmationEmail } from '../../lib/email';
import { logContactMessage } from '../../lib/sheets';
import { EMAIL_USER, EMAIL_DOMAIN } from '../../lib/contact';

// On-demand route, same reasoning as /api/subscribe — it has to run
// server-side to write to the database.
export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  if (!name || !EMAIL_RE.test(email) || !message) {
    return new Response(
      JSON.stringify({ success: false, error: 'Fill in your name, a valid email, and a message.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    insertMessage({ name, email, message });
  } catch (err) {
    console.error('Failed to save message:', err);
    return new Response(JSON.stringify({ success: false, error: 'Something went wrong. Try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Best-effort notification to Warren, plus a confirmation back to the
  // visitor — the message is already saved above even if either send fails
  // or Resend isn't configured yet.
  await sendConfirmationEmail({
    to: `${EMAIL_USER}@${EMAIL_DOMAIN}`,
    subject: `New message from ${name} (site contact form)`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <p><strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}) sent this from the contact form:</p>
        <p style="white-space: pre-wrap; border-left: 3px solid #F15A29; padding-left: 12px;">${escapeHtml(message)}</p>
      </div>
    `,
  });

  await sendConfirmationEmail({
    to: email,
    subject: "We've got your message — Tingen Creative",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <p>Thanks for reaching out, ${escapeHtml(name)} — I'll reply personally, usually within a business day.</p>
        <p>In the meantime, if it's urgent, feel free to call or text at 470-345-5310.</p>
        <p>— Warren Tingen, Tingen Creative</p>
      </div>
    `,
  });

  // Best-effort row in the Google Sheet Warren tracks leads in — never
  // blocks or fails the response if Sheets access isn't configured.
  const sheetResult = await logContactMessage({ name, email, message });
  if (!sheetResult.ok) console.error('Failed to log contact message to Sheets:', sheetResult.reason);

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
