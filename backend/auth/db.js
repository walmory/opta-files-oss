/**
 * Opta Files — accounts database (SQLite, built into Node ≥ 22.13 as `node:sqlite`).
 * One file on disk, no native dependency to compile, WAL mode so reads never block writes.
 */
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const open = (dataDir) => {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'accounts.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 3000;

    CREATE TABLE IF NOT EXISTS users (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      email             TEXT NOT NULL,           -- as typed (lower-cased), used for sending
      email_canonical   TEXT NOT NULL UNIQUE,    -- aliases collapsed: j.o.a.o+x@gmail.com → joao@gmail.com
      phone             TEXT NOT NULL UNIQUE,    -- E.164, canonicalised (+55 mobile always with the 9)
      password_hash     TEXT NOT NULL,
      email_verified_at INTEGER,
      phone_verified_at INTEGER,
      plan              TEXT NOT NULL DEFAULT 'free',
      status            TEXT NOT NULL DEFAULT 'active',
      device_id         TEXT,
      created_ip        TEXT,                    -- HMAC of the IP, never the raw address
      created_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS users_device  ON users(device_id);
    CREATE INDEX IF NOT EXISTS users_ip_time ON users(created_ip, created_at);

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash   TEXT PRIMARY KEY,             -- SHA-256 of the bearer token; the token itself is never stored
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      user_agent   TEXT
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS verifications (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel     TEXT NOT NULL CHECK (channel IN ('email','phone')),
      code_hash   TEXT NOT NULL,
      attempts    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      consumed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS verifications_user ON verifications(user_id, channel, created_at);

    CREATE TABLE IF NOT EXISTS usage (
      subject TEXT NOT NULL,                     -- 'u:<userId>' or 'ip:<hmac>'
      day     TEXT NOT NULL,                     -- YYYY-MM-DD (UTC)
      count   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (subject, day)
    );
  `);

  // Housekeeping: expired sessions, old codes and usage rows older than 60 days.
  const purge = () => {
    const now = Date.now();
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    db.prepare('DELETE FROM verifications WHERE expires_at < ?').run(now - 86_400_000);
    db.prepare("DELETE FROM usage WHERE day < date('now','-60 days')").run();
  };
  purge();
  setInterval(purge, 3_600_000).unref();

  return db;
};

module.exports = { open };
