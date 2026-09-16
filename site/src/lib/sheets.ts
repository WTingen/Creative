import { createSign } from 'node:crypto';

// Best-effort Google Sheets logging, mirroring the resilience pattern in
// email.ts — reads credentials at call time, never throws, and a missing
// config just means rows silently don't get logged (the SQLite record is
// already saved by the time this runs).

let cachedToken: { token: string; expiresAt: number } | null = null;

function base64url(input: string) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(): Promise<string | null> {
  const email = import.meta.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = import.meta.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !privateKey) return null;

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign(privateKey)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function appendRow(tab: string, values: unknown[]): Promise<{ ok: boolean; reason?: string }> {
  const spreadsheetId = import.meta.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) return { ok: false, reason: 'GOOGLE_SHEETS_SPREADSHEET_ID not configured' };

  try {
    const token = await getAccessToken();
    if (!token) return { ok: false, reason: 'Google service account not configured' };

    const range = encodeURIComponent(`'${tab}'!A1`);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [values] }),
      }
    );
    if (!res.ok) {
      return { ok: false, reason: `Sheets API ${res.status}: ${await res.text()}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Unknown error' };
  }
}

const SERVICE_LABELS: Record<string, string> = {
  foundations: 'Built Brand Foundations',
  alignment: 'Brand Alignment',
  marketing: 'Monthly Marketing',
};

export function logNewsletterSignup({ email, source, detail }: { email: string; source: string; detail?: string }) {
  return appendRow('Newsletter Signups', [new Date().toISOString(), email, source, detail ?? '']);
}

export function logContactMessage({ name, email, message }: { name: string; email: string; message: string }) {
  return appendRow('Contact Messages', [new Date().toISOString(), name, email, message]);
}

interface BrandReviewCategory {
  name: string;
  score: number;
  max: number;
}

export function logBrandReviewResult({
  email,
  score,
  maxScore,
  tierLabel,
  tierSummary,
  categories,
  ctaBucket,
}: {
  email: string;
  score: number;
  maxScore: number;
  tierLabel: string;
  tierSummary: string;
  categories: BrandReviewCategory[];
  ctaBucket: string;
}) {
  const byName = Object.fromEntries(categories.map((c) => [c.name, `${c.score}/${c.max}`]));
  return appendRow('Brand Review Results', [
    new Date().toISOString(),
    email,
    score,
    maxScore,
    tierLabel,
    tierSummary,
    byName['Brand Identity'] ?? '',
    byName['Internal Brand Culture'] ?? '',
    byName['Customer Experience & Perception'] ?? '',
    byName['Brand Performance'] ?? '',
    byName['Digital Presence & Marketing'] ?? '',
    SERVICE_LABELS[ctaBucket] ?? ctaBucket,
  ]);
}
