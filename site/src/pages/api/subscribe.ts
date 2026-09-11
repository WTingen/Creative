import type { APIRoute } from 'astro';
import { insertLead } from '../../lib/db';
import { sendConfirmationEmail } from '../../lib/email';

// This is the one route on the site that runs on-demand instead of being
// prerendered to a static file — it has to actually execute server-side to
// write to the database.
export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const source = typeof body.source === 'string' ? body.source : 'unknown';
  const detail = typeof body.detail === 'string' ? body.detail : undefined;

  if (!EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ success: false, error: 'Enter a valid email address.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    insertLead({ email, source, detail });
  } catch (err) {
    console.error('Failed to save lead:', err);
    return new Response(JSON.stringify({ success: false, error: 'Something went wrong. Try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Best-effort confirmation email — a lead is already saved above even if
  // this fails or Resend isn't configured yet.
  await sendConfirmationEmail({
    to: email,
    subject: 'You\'re subscribed to Tingen Creative',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <p>Thanks for subscribing — you'll hear from us when there's something worth reading.</p>
        <p>— Warren Tingen, Tingen Creative</p>
      </div>
    `,
  });

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
