import { env, applyD1Migrations } from 'cloudflare:test';
await applyD1Migrations(env.DB, [
  {
    name: '001_init.sql',
    queries: [
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        short_code TEXT UNIQUE NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        status TEXT NOT NULL DEFAULT 'active',
        expires_at INTEGER,
        host_pin TEXT
      );`,
      `CREATE TABLE IF NOT EXISTS parties (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        name TEXT,
        size INTEGER,
        joined_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        status TEXT NOT NULL DEFAULT 'waiting',
        nearby INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );`,
      `CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        party_id TEXT,
        type TEXT NOT NULL,
        ts INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        details TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (party_id) REFERENCES parties(id)
      );`,
      `CREATE INDEX IF NOT EXISTS idx_parties_session ON parties(session_id);`,
      `CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(session_id, ts);`,
    ],
  },
  {
    name: '002_add_event_name.sql',
    queries: [`ALTER TABLE sessions ADD COLUMN event_name TEXT;`],
  },
  {
    name: '003_add_max_guests.sql',
    queries: [`ALTER TABLE sessions ADD COLUMN max_guests INTEGER DEFAULT 100;`],
  },
]);
