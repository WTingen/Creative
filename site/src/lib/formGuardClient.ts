// Browser half of src/lib/spamGuard.ts — collects the honeypot value, how
// long the page has been open, and the Turnstile token, to send along with
// a form submission.
import { HONEYPOT_FIELD } from './spamGuard';

const pageLoadedAt = Date.now();

declare global {
  interface Window {
    turnstile?: { reset: (widget: Element) => void };
  }
}

export function guardFields(form: HTMLFormElement) {
  const honeypot = form.querySelector<HTMLInputElement>(`input[name="${HONEYPOT_FIELD}"]`);
  const token = form.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
  return {
    [HONEYPOT_FIELD]: honeypot?.value ?? '',
    elapsedMs: Date.now() - pageLoadedAt,
    turnstileToken: token?.value ?? '',
  };
}

// Turnstile tokens are single-use — get a fresh one after every submit so a
// retry (or a second message) doesn't fail verification.
export function resetGuard(form: HTMLFormElement) {
  const widget = form.querySelector('.cf-turnstile');
  if (widget && window.turnstile) window.turnstile.reset(widget);
}
