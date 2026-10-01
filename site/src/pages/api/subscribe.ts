import type { APIRoute } from 'astro';
import { insertLead } from '../../lib/db';
import { sendConfirmationEmail } from '../../lib/email';
import { logNewsletterSignup, logBrandReviewResult } from '../../lib/sheets';
import { CALENDLY_URL, EMAIL_USER, EMAIL_DOMAIN } from '../../lib/contact';
import { rebuildBrandReviewResult, type BrandReviewResult } from '../../lib/brandReview';
import { checkSubmission, guardRejection, escapeHtml, json } from '../../lib/spamGuard';

// This is the one route on the site that runs on-demand instead of being
// prerendered to a static file — it has to actually execute server-side to
// write to the database.
export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_EMAIL = 254;
const ALLOWED_SOURCES = ['blog', 'brand-review'];
const DETAIL_RE = /^[a-z0-9-]{1,100}$/;

// Short, practical improvement notes per category — shown under each
// category's score in the results email regardless of exactly how they
// scored, since the fix is the same direction either way.
const CATEGORY_TIPS: Record<string, string> = {
  'Brand Identity':
    'A logo and visual identity that actually reflects your niche — and stays consistent everywhere a prospect sees you — is usually the fastest way to look as credible as the deals you already close.',
  'Internal Brand Culture':
    "When your own team can't describe the brand the same way, it shows up inconsistently everywhere else. A short internal alignment session closes this gap faster than most people expect.",
  'Customer Experience & Perception':
    'How you get remembered next to competitors comes down to the experience you actually deliver, not just what you say about yourself. Small, consistent touches compound quickly.',
  'Brand Performance':
    "If it's hard to tie your brand to referrals, retention, or new business, it's worth building a simple way to track and tell that story — it usually reveals where the real leverage is.",
  'Digital Presence & Marketing':
    'Your website and marketing materials are often the first — and sometimes only — impression. Making sure they match the caliber of your actual work pays off fast.',
};

function buildBrandReviewEmail(extra: BrandReviewResult) {
  const categoryRows = extra.categories
    .map((cat) => {
      const tip = CATEGORY_TIPS[cat.name] ?? '';
      return `
        <div style="margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 14px; color: #1A1815;">
            <span>${escapeHtml(cat.name)}</span>
            <span>${cat.score} / ${cat.max}</span>
          </div>
          <p style="margin: 6px 0 0; font-size: 13px; line-height: 1.6; color: #656565;">${tip}</p>
        </div>
      `;
    })
    .join('');

  return {
    subject: `Your Brand Review results: ${extra.tierLabel} (${extra.score}/${extra.maxScore})`,
    html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #1A1815;">
        <p style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #F15A29;">Your Brand Review Result</p>
        <h1 style="font-size: 22px; margin: 4px 0 0;">${extra.tierLabel} — ${extra.score} / ${extra.maxScore}</h1>
        <p style="font-size: 14px; line-height: 1.7; color: #656565;">${extra.tierSummary}</p>

        <div style="margin: 28px 0; padding-top: 20px; border-top: 1px solid #E9E5DE;">
          ${categoryRows}
        </div>

        <div style="margin-top: 24px; padding: 20px; background: #656565; border-radius: 12px; text-align: center;">
          <p style="color: white; font-weight: 700; font-size: 15px; margin: 0 0 12px;">Want help closing these gaps?</p>
          <a href="${CALENDLY_URL}" style="display: inline-block; background: #F15A29; color: white; font-weight: 700; font-size: 14px; text-decoration: none; padding: 12px 24px; border-radius: 10px;">Book a Call</a>
        </div>

        <p style="margin-top: 24px; font-size: 13px; color: #656565;">— Warren Tingen, Tingen Creative</p>
      </div>
    `,
  };
}

// Notification to Warren so every signup gets seen, not just contact-form
// messages. Brand Review submissions include the full breakdown so there's
// something concrete to follow up on if he reaches out.
function buildWarrenNotification(
  email: string,
  source: string,
  detail: string | undefined,
  extra: BrandReviewResult | undefined
) {
  if (extra) {
    const categoryLines = extra.categories
      .map((cat) => `<li>${escapeHtml(cat.name)}: <strong>${cat.score} / ${cat.max}</strong></li>`)
      .join('');
    return {
      subject: `New Brand Review: ${email} — ${extra.tierLabel} (${extra.score}/${extra.maxScore})`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <p><strong>${escapeHtml(email)}</strong> just completed the Brand Review.</p>
          <p>Result: <strong>${extra.tierLabel}</strong> — ${extra.score} / ${extra.maxScore}</p>
          <ul style="padding-left: 18px; line-height: 1.8;">${categoryLines}</ul>
          <p>Routed to: <strong>${escapeHtml(extra.ctaBucket)}</strong></p>
        </div>
      `,
    };
  }
  return {
    subject: `New newsletter signup: ${email}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <p><strong>${escapeHtml(email)}</strong> just subscribed.</p>
        <p>Source: ${escapeHtml(source)}${detail ? ` (${escapeHtml(detail)})` : ''}</p>
      </div>
    `,
  };
}

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid request body' }, 400);
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const source = typeof body.source === 'string' ? body.source : '';
  const rawDetail = typeof body.detail === 'string' ? body.detail : undefined;

  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL) {
    return json({ success: false, error: 'Enter a valid email address.' }, 400);
  }
  if (!ALLOWED_SOURCES.includes(source) || (rawDetail !== undefined && !DETAIL_RE.test(rawDetail))) {
    return json({ success: false, error: 'Invalid request body' }, 400);
  }

  const guard = await checkSubmission(request, body);
  if (!guard.ok) return guardRejection(guard, '/api/subscribe');

  // Brand Review results are rebuilt from the raw category scores rather
  // than trusted as sent — the tier text ends up in an email from our
  // domain, so it must only ever be our own copy.
  const review = source === 'brand-review' ? rebuildBrandReviewResult(body.extra) : null;
  const detail = review ? review.ctaBucket : rawDetail;

  try {
    insertLead({ email, source, detail });
  } catch (err) {
    console.error('Failed to save lead:', err);
    return json({ success: false, error: 'Something went wrong. Try again.' }, 500);
  }

  // Best-effort confirmation email — a lead is already saved above even if
  // this fails or Resend isn't configured yet. Brand Review submissions with
  // a valid results payload get the full breakdown instead of the generic note.
  const emailContent = review
    ? buildBrandReviewEmail(review)
    : {
        subject: "You're subscribed to Tingen Creative",
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <p>Thanks for subscribing — you'll hear from us when there's something worth reading.</p>
            <p>— Warren Tingen, Tingen Creative</p>
          </div>
        `,
      };

  await sendConfirmationEmail({
    to: email,
    subject: emailContent.subject,
    html: emailContent.html,
  });

  // Best-effort notification to Warren for every signup, not just contact
  // form submissions.
  const notification = buildWarrenNotification(email, source, detail, review ?? undefined);
  await sendConfirmationEmail({
    to: `${EMAIL_USER}@${EMAIL_DOMAIN}`,
    subject: notification.subject,
    html: notification.html,
  });

  // Best-effort row in the Google Sheet Warren tracks leads in — never
  // blocks or fails the response if Sheets access isn't configured.
  if (review) {
    const result = await logBrandReviewResult({ email, ...review });
    if (!result.ok) console.error('Failed to log Brand Review result to Sheets:', result.reason);
  } else {
    const result = await logNewsletterSignup({ email, source, detail });
    if (!result.ok) console.error('Failed to log signup to Sheets:', result.reason);
  }

  return json({ success: true });
};
