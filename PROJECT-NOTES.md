# Tingen Creative Site — Project Notes

Last updated: 2026-09-16

This file is the handoff reference for this project — infra details, where
credentials live, and how deploys work. Read this first in any new session
before touching infrastructure.

## Overview

- Astro 7 site (`site/`), static-first with one on-demand API route pair
  (`/api/subscribe`, `/api/contact`) via `@astrojs/node` in standalone mode.
- Hosted on a Vultr VPS (migrated off Closte hosting / Google Domains DNS in
  September 2026).
- Real backend: SQLite for lead/message storage, Resend for transactional
  email, Google Sheets for a human-readable live log of every signup.

## Hosting (Vultr)

- Instance: `54371477-998b-4fa6-acf8-dea34048c777`, Debian 13, plan
  `vc2-1c-1gb` (1 vCPU / 1GB RAM / 25GB disk), region `atl`.
- Public IPv4: `96.30.195.76` — this is what DNS points at.
- Public IPv6: `2001:19f0:5400:37a9:5400:06ff:feb1:604d`
- SSH: key-only auth (password login disabled). Private key at
  `deploy/keys/vultr_tingencreative` (gitignored — never commit this).
  ```
  ssh -i deploy/keys/vultr_tingencreative root@96.30.195.76
  ```
- App lives at `/var/www/tingencreative` on the server, owned by a dedicated
  `tingen` system user (not root). Runs as systemd service `tingencreative`
  (`systemctl status|restart tingencreative`), listening on
  `127.0.0.1:4321`.
- nginx reverse-proxies 80/443 → the app. Config at
  `/etc/nginx/sites-available/tingencreative`. TLS via Let's Encrypt/certbot,
  auto-renews (certbot's systemd timer). HTTP redirects to HTTPS.
- Firewall (ufw): only 22, 80, 443 open.
- Vultr account API key lives in `deploy/.env` (`VULTR_API_KEY`, gitignored)
  — used for DNS/instance management via the Vultr API, not needed for
  normal deploys.

## Deploying an update

Build locally, then ship only the built output — do **not** build on the
server (1GB RAM plus Sharp's image processing during `astro build` is too
tight; native deps like `better-sqlite3` get compiled on the server instead,
which is lightweight).

```bash
cd site
npm run build
KEY=../deploy/keys/vultr_tingencreative
HOST=96.30.195.76
rsync -az --delete -e "ssh -i $KEY" dist/ "root@$HOST:/var/www/tingencreative/dist/"
# only if package.json/package-lock.json changed:
rsync -az -e "ssh -i $KEY" package.json package-lock.json "root@$HOST:/var/www/tingencreative/"
ssh -i "$KEY" "root@$HOST" "cd /var/www/tingencreative && npm ci --omit=dev" # only if deps changed
ssh -i "$KEY" "root@$HOST" "chown -R tingen:tingen /var/www/tingencreative && systemctl restart tingencreative"
```

`.env` on the server (`/var/www/tingencreative/.env`) is separate from the
local `site/.env` — if you add/change env vars locally, re-sync that file
too (`rsync -az -e "ssh -i $KEY" site/.env root@$HOST:/var/www/tingencreative/.env`)
and restart the service.

## DNS

Domain's nameservers point at Vultr (`ns1.vultr.com`, `ns2.vultr.com`) — the
DNS zone is managed via the Vultr dashboard/API, not Squarespace or Google
Domains (both are no longer in the picture). Records: A/AAAA for `@` and
`www` → the server above, 5 MX records for Google Workspace email (unchanged
from before the migration), SPF TXT, Google Workspace DKIM TXT, and the 3
Resend sending-domain records (see below).

## Email (Resend)

- Sending domain `contact.tingencreative.com` is verified.
- Credentials in `site/.env`: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.
- Every form submission sends two emails: a confirmation to the submitter,
  and a notification to `warren@tingencreative.com` (contact form, newsletter
  signups, and Brand Review completions all notify — the Brand Review one
  includes the score/tier breakdown so there's something to follow up on).
- Email sending is best-effort everywhere — a missing/invalid
  `RESEND_API_KEY` just means emails silently don't send; the lead is still
  saved to the database and logged to Sheets either way.

## Google Sheets logging

Every form submission also appends a row to a live spreadsheet, in addition
to SQLite.

- Spreadsheet: [Tingen Creative - Leads](https://docs.google.com/spreadsheets/d/1FJwF3ZOgiT1RFGr8O-HxA5Y2FHcyNsQaaBOPg9Ir-z4)
  — shared with `warren@tingencreative.com`.
- Tabs: **Newsletter Signups**, **Brand Review Results** (full per-category
  breakdown + recommended service), **Contact Messages**.
- Auth: GCP service account `tingencreative-sheets@atomic-quasar-508614-i8.iam.gserviceaccount.com`
  (project `atomic-quasar-508614-i8`, the same project used for Resend's DNS
  investigation earlier — reused rather than creating a new one), shared as
  Editor on the sheet. Credentials in `site/.env`:
  `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`,
  `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`. Raw key backup at
  `deploy/keys/sheets-service-account.json` (gitignored).
- Logic in `site/src/lib/sheets.ts` — signs its own JWT and calls the Sheets
  API directly via `fetch` (no `googleapis` dependency, keeps the server
  lightweight). Best-effort like email — logging failures are caught and
  logged to the server console, never block the actual form response.

## Database

SQLite at `data/leads.db` relative to the app's working directory (so
`/var/www/tingencreative/data/leads.db` in production, `site/data/leads.db`
in local dev) — gitignored, contains real lead PII. Two tables: `leads`
(newsletter + Brand Review signups, tagged by `source`/`detail`) and
`messages` (contact form).

## Credentials — what's where

All of the following are gitignored and must never be committed:

| What | Where |
|---|---|
| Vultr API key | `deploy/.env` |
| Vultr SSH deploy key | `deploy/keys/vultr_tingencreative` (+ `.pub`) |
| Resend API key + from-address | `site/.env` |
| Google service account (Sheets) | `site/.env` + backup JSON in `deploy/keys/` |
| Stripe checkout links (Monthly Marketing) | hardcoded in `site/src/pages/services.astro` — these are public checkout URLs, not secrets |

## Form spam protection (added 2026-10-01)

Late Sept 2026 a bot (mostly via Tor) posted ~1/hour to `/api/contact`
with random-letter messages and *other people's* email addresses — classic
"subscription bombing", using our auto-reply to flood victims' inboxes.
Fixes:

- Contact form no longer auto-replies to the submitter at all.
- Both API routes run `checkSubmission()` (`site/src/lib/spamGuard.ts`)
  before saving/sending anything: honeypot field, 3s minimum fill time,
  and Cloudflare Turnstile. Bot-looking submissions get a fake
  `{success: true}` and are logged as `Blocked ...` in
  `journalctl -u tingencreative`.
- Turnstile keys configured 2026-10-01 (widget is in Cloudflare
  dashboard -> Turnstile, hostname tingencreative.com). It's enforced only when
  `TURNSTILE_SECRET_KEY` (server) and
  `PUBLIC_TURNSTILE_SITE_KEY` (baked in at build) are set in `.env` — set
  both, rebuild, and re-sync the server `.env`.
- Brand Review tier/summary are recomputed server-side from category
  scores (`site/src/lib/brandReview.ts`), never trusted from the client.
- Sheets appends use `valueInputOption=RAW` (no formula injection).
- nginx rate-limits `/api/` to 5 req/min per IP (burst 5):
  `/etc/nginx/conf.d/tingencreative-ratelimit.conf` + a `location /api/`
  block in the site config. Pre-change backup at
  `/root/tingencreative.nginx.bak-20261001`.

## Open items

None outstanding as of this writing. Past open items (Closte account
closure, per-signup notifications to Warren, a duplicate WordPress export
file) were all resolved in the same session this file was written in.
