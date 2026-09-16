import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

// A single SQLite file holding every lead capture on the site (blog signups,
// the Brand Review tool, the contact form). Resolved from process.cwd()
// rather than import.meta.url — the latter points at wherever the bundler
// placed this module in dist/server/chunks/, which shifts with every build
// and breaks the relative path. cwd is the site/ directory both in `astro
// dev` and in the production `node ./dist/server/entry.mjs` start script.
const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'leads.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    source TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

interface NewLead {
  email: string;
  /** Where the signup came from, e.g. "blog", "brand-review", "contact" */
  source: string;
  /** Optional extra context, e.g. the blog post slug they signed up from */
  detail?: string;
}

export function insertLead({ email, source, detail }: NewLead) {
  const stmt = db.prepare(
    'INSERT INTO leads (email, source, detail) VALUES (?, ?, ?)'
  );
  return stmt.run(email, source, detail ?? null);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

interface NewMessage {
  name: string;
  email: string;
  message: string;
}

export function insertMessage({ name, email, message }: NewMessage) {
  const stmt = db.prepare(
    'INSERT INTO messages (name, email, message) VALUES (?, ?, ?)'
  );
  return stmt.run(name, email, message);
}
