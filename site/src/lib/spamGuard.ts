// Bot filtering shared by /api/contact and /api/subscribe. Both endpoints
// send email to whatever address is submitted, which makes them attractive
// for "subscription bombing" (flooding a victim's inbox with real-looking
// confirmations from legitimate sites) — so nothing gets saved or sent
// until a submission clears these checks.

export const HONEYPOT_FIELD = 'website';
const MIN_FILL_MS = 3000;
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type GuardResult =
  // Looks like a bot — the caller should return a fake success so the bot
  // gets no signal about what tripped it.
  | { ok: false; silent: true; reason: string }
  // Turnstile failed — could be a real person, so tell them to retry.
  | { ok: false; silent: false; reason: string }
  | { ok: true };

function clientIp(request: Request) {
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    undefined
  );
}

async function verifyTurnstile(token: string, ip: string | undefined) {
  const secret = import.meta.env.TURNSTILE_SECRET_KEY;
  // Not configured yet — the honeypot and timing checks still apply.
  if (!secret) return true;
  if (!token) return false;

  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set('remoteip', ip);
  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body: form });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    // Cloudflare unreachable — fail closed, the visitor can retry.
    console.error('Turnstile verification request failed:', err);
    return false;
  }
}

export async function checkSubmission(request: Request, body: Record<string, unknown>): Promise<GuardResult> {
  const honeypot = body[HONEYPOT_FIELD];
  if (typeof honeypot === 'string' && honeypot.trim() !== '') {
    return { ok: false, silent: true, reason: 'honeypot filled' };
  }

  // Elapsed time since the form's page loaded, measured client-side so clock
  // skew doesn't matter. Missing entirely means the request didn't come from
  // our page script at all.
  const elapsed = body.elapsedMs;
  if (typeof elapsed !== 'number' || elapsed < MIN_FILL_MS) {
    return { ok: false, silent: true, reason: `submitted too fast (${String(elapsed)})` };
  }

  const token = typeof body.turnstileToken === 'string' ? body.turnstileToken : '';
  if (!(await verifyTurnstile(token, clientIp(request)))) {
    return { ok: false, silent: false, reason: 'turnstile failed' };
  }

  return { ok: true };
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function guardRejection(result: Exclude<GuardResult, { ok: true }>, endpoint: string) {
  console.warn(`Blocked ${endpoint} submission: ${result.reason}`);
  return result.silent
    ? json({ success: true })
    : json({ success: false, error: 'Verification failed — refresh the page and try again.' }, 400);
}
