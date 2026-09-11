# legacy-site/

Reference material pulled from the live WordPress install (tingencreative.com, hosted on Closte) for the redesign. **This is not code to build on** — no plugins, themes, or cache were pulled, and nothing here should be reused directly in the rebuild.

## Contents

- `uploads/` — full `wp-content/uploads` media library. 1,224 files, 149MB, none over 50MB (largest is a 10MB PNG). Pulled via SFTP on 2026-09-08.
- `content-export.xml` — WordPress WXR export (Tools → Export → All content) from wp-admin. 319 items: posts, pages, menus, and attachment records. Pulled 2026-09-08.

## What's missing and why

The hosting account (`618d5b12c1ac188ae00772b5@35.190.174.218:55000`) is **SFTP-only** — no shell access, so `wp-cli` and server-side `mysqldump` were both unavailable. The WXR export above was taken from wp-admin instead, which covers post/page/menu content but not the raw database (settings, non-content tables, revision history, etc.). If a full DB dump is ever needed, it'll require either enabling shell access through Closte's panel or exporting through a DB tool in their dashboard (phpMyAdmin/Adminer).
