import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A single SQLite file holding every lead capture on the site (blog signups,
// the Brand Review tool once it's built, the contact form). Lives outside
// src/ and dist/ so it survives rebuilds and redeploys.
const dbPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../data/leads.db'
);

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
