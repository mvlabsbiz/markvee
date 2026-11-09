'use strict';

/**
 * File-backed access store for the isolated modules.
 * Uses Node's built-in SQLite so there is no hosted database and no new package.
 * Statements commit in transactions. A corrupt or world-readable file is refused.
 * Rows hold digests and session identifiers, not raw phone numbers or codes.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 1;

function storageError() {
  const err = new Error('storage unavailable');
  err.code = 'STORAGE';
  return err;
}

function createDurableStore(filePath) {
  if (typeof filePath !== 'string' || filePath === '' || filePath === ':memory:') {
    throw storageError();
  }
  const dir = path.dirname(filePath);
  let existed = false;
  try {
    existed = fs.existsSync(filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    assertPrivate(dir, 0o0700);
    if (existed) assertPrivate(filePath, 0o0600);
  } catch (err) {
    if (err.code === 'STORAGE') throw err;
    throw storageError();
  }

  let db;
  try {
    db = new DatabaseSync(filePath);
    fs.chmodSync(filePath, 0o600);
    for (const suffix of ['-journal', '-wal', '-shm']) {
      const sidecar = filePath + suffix;
      if (fs.existsSync(sidecar)) fs.chmodSync(sidecar, 0o600);
    }
    assertPrivate(filePath, 0o0600);
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA busy_timeout = 5000');
    const integrity = db.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') throw storageError();
    if (existed) assertSchema(db);
    else createSchema(db);
  } catch (err) {
    if (db) {
      try { db.close(); } catch { /* already closed */ }
    }
    if (err.code === 'STORAGE') throw err;
    throw storageError();
  }

  let depth = 0;

  function transaction(fn) {
    if (depth > 0) return fn();
    db.exec('BEGIN IMMEDIATE');
    depth += 1;
    try {
      const result = fn();
      depth -= 1;
      db.exec('COMMIT');
      return result;
    } catch (err) {
      depth -= 1;
      try { db.exec('ROLLBACK'); } catch { /* rollback after a failed commit */ }
      throw err;
    }
  }

  const saveAccount = db.prepare(`
    INSERT INTO accounts (
      id, phone_hmac, access, phone_verified_at, session_generation,
      introduction, evidence_note, submitted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      phone_hmac = excluded.phone_hmac,
      access = excluded.access,
      phone_verified_at = excluded.phone_verified_at,
      session_generation = excluded.session_generation,
      introduction = excluded.introduction,
      evidence_note = excluded.evidence_note,
      submitted_at = excluded.submitted_at
  `);
  const selectAccount = db.prepare('SELECT * FROM accounts WHERE id = ?');
  const selectAccountByPhone = db.prepare('SELECT * FROM accounts WHERE phone_hmac = ?');
  const selectAccounts = db.prepare('SELECT * FROM accounts');

  function accountFromRow(row) {
    if (!row) return null;
    const account = {
      id: row.id,
      phoneHmac: row.phone_hmac,
      access: row.access,
      phoneVerifiedAt: row.phone_verified_at,
      sessionGeneration: row.session_generation,
      introduction: row.introduction,
      evidenceNote: row.evidence_note,
      submittedAt: row.submitted_at,
    };
    return new Proxy(account, {
      set(target, prop, value) {
        target[prop] = value;
        saveAccount.run(
          target.id,
          target.phoneHmac,
          target.access,
          target.phoneVerifiedAt,
          target.sessionGeneration,
          target.introduction,
          target.evidenceNote,
          target.submittedAt,
        );
        return true;
      },
    });
  }

  function writeAccount(account) {
    saveAccount.run(
      account.id,
      account.phoneHmac,
      account.access,
      account.phoneVerifiedAt || null,
      account.sessionGeneration,
      account.introduction || '',
      account.evidenceNote || '',
      account.submittedAt || null,
    );
  }

  const accounts = {
    get(id) {
      return accountFromRow(selectAccount.get(id));
    },
    set(id, account) {
      writeAccount({ ...account, id });
      return this;
    },
    values() {
      return selectAccounts.all().map((row) => accountFromRow(row));
    },
  };

  const saveSession = db.prepare(`
    INSERT INTO sessions (
      id, account_id, generation, csrf_token, created_at, expires_at, idle_expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      account_id = excluded.account_id,
      generation = excluded.generation,
      csrf_token = excluded.csrf_token,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at,
      idle_expires_at = excluded.idle_expires_at
  `);
  const selectSession = db.prepare('SELECT * FROM sessions WHERE id = ?');
  const deleteSession = db.prepare('DELETE FROM sessions WHERE id = ?');
  const countSessions = db.prepare('SELECT COUNT(*) AS n FROM sessions');

  function sessionFromRow(row) {
    if (!row) return null;
    const session = {
      id: row.id,
      accountId: row.account_id,
      generation: row.generation,
      csrfToken: row.csrf_token,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      idleExpiresAt: row.idle_expires_at,
    };
    return new Proxy(session, {
      set(target, prop, value) {
        target[prop] = value;
        saveSession.run(
          target.id,
          target.accountId,
          target.generation,
          target.csrfToken,
          target.createdAt,
          target.expiresAt,
          target.idleExpiresAt,
        );
        return true;
      },
    });
  }

  const sessions = {
    get size() {
      return countSessions.get().n;
    },
    get(id) {
      return sessionFromRow(selectSession.get(id));
    },
    set(id, session) {
      saveSession.run(
        id,
        session.accountId,
        session.generation,
        session.csrfToken,
        session.createdAt,
        session.expiresAt,
        session.idleExpiresAt,
      );
      return this;
    },
    delete(id) {
      deleteSession.run(id);
      return true;
    },
  };

  const saveChallenge = db.prepare(`
    INSERT INTO challenges (phone_hmac, code_hash, expires_at, attempts)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(phone_hmac) DO UPDATE SET
      code_hash = excluded.code_hash,
      expires_at = excluded.expires_at,
      attempts = excluded.attempts
  `);
  const selectChallenge = db.prepare('SELECT * FROM challenges WHERE phone_hmac = ?');
  const deleteChallenge = db.prepare('DELETE FROM challenges WHERE phone_hmac = ?');
  const countChallenges = db.prepare('SELECT COUNT(*) AS n FROM challenges');

  function challengeFromRow(row) {
    if (!row) return null;
    const challenge = {
      codeHash: row.code_hash,
      expiresAt: row.expires_at,
      attempts: row.attempts,
    };
    return new Proxy(challenge, {
      set(target, prop, value) {
        target[prop] = value;
        saveChallenge.run(row.phone_hmac, target.codeHash, target.expiresAt, target.attempts);
        return true;
      },
    });
  }

  const challenges = {
    get size() {
      return countChallenges.get().n;
    },
    get(key) {
      return challengeFromRow(selectChallenge.get(key));
    },
    set(key, challenge) {
      saveChallenge.run(key, challenge.codeHash, challenge.expiresAt, challenge.attempts);
      return this;
    },
    delete(key) {
      deleteChallenge.run(key);
      return true;
    },
  };

  const insertConsumed = db.prepare(`
    INSERT OR IGNORE INTO consumed_codes (phone_hmac, code_hash, consumed_at)
    VALUES (?, ?, ?)
  `);
  const selectConsumed = db.prepare(`
    SELECT 1 AS n FROM consumed_codes WHERE phone_hmac = ? AND code_hash = ?
  `);

  const selectRate = db.prepare('SELECT kind, at FROM rate_events WHERE bucket_key = ? ORDER BY at');
  const deleteRate = db.prepare('DELETE FROM rate_events WHERE bucket_key = ?');
  const insertRate = db.prepare('INSERT INTO rate_events (bucket_key, kind, at) VALUES (?, ?, ?)');

  const rate = {
    get(key) {
      const sends = [];
      const attempts = [];
      for (const row of selectRate.all(key)) {
        if (row.kind === 'send') sends.push(row.at);
        else if (row.kind === 'attempt') attempts.push(row.at);
      }
      return { sends, attempts };
    },
    set(key, bucket) {
      deleteRate.run(key);
      for (const at of bucket.sends || []) insertRate.run(key, 'send', at);
      for (const at of bucket.attempts || []) insertRate.run(key, 'attempt', at);
      return this;
    },
  };

  const insertDirectory = db.prepare('INSERT OR IGNORE INTO directory (phone_hmac) VALUES (?)');
  const selectDirectory = db.prepare('SELECT 1 AS n FROM directory WHERE phone_hmac = ?');
  const deleteDirectory = db.prepare('DELETE FROM directory WHERE phone_hmac = ?');
  const allDirectory = db.prepare('SELECT phone_hmac FROM directory');

  const directory = {
    add(key) {
      insertDirectory.run(key);
      return this;
    },
    has(key) {
      return Boolean(selectDirectory.get(key));
    },
    delete(key) {
      deleteDirectory.run(key);
      return true;
    },
    clear() {
      db.exec('DELETE FROM directory');
    },
    [Symbol.iterator]() {
      return allDirectory.all().map((row) => row.phone_hmac)[Symbol.iterator]();
    },
  };

  const saveChange = db.prepare(`
    INSERT INTO change_requests (
      id, from_account_id, new_phone_hmac, proof_at, decided_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      from_account_id = excluded.from_account_id,
      new_phone_hmac = excluded.new_phone_hmac,
      proof_at = excluded.proof_at,
      decided_at = excluded.decided_at,
      created_at = excluded.created_at
  `);
  const selectChange = db.prepare('SELECT * FROM change_requests WHERE id = ?');
  const selectChanges = db.prepare('SELECT * FROM change_requests');

  function changeFromRow(row) {
    if (!row) return null;
    const change = {
      id: row.id,
      fromAccountId: row.from_account_id,
      newPhoneHmac: row.new_phone_hmac,
      proofAt: row.proof_at,
      decidedAt: row.decided_at,
      createdAt: row.created_at,
    };
    return new Proxy(change, {
      set(target, prop, value) {
        target[prop] = value;
        saveChange.run(
          target.id,
          target.fromAccountId,
          target.newPhoneHmac,
          target.proofAt,
          target.decidedAt,
          target.createdAt,
        );
        return true;
      },
    });
  }

  const changeRequests = {
    get(id) {
      return changeFromRow(selectChange.get(id));
    },
    set(id, change) {
      saveChange.run(
        id,
        change.fromAccountId,
        change.newPhoneHmac,
        change.proofAt || null,
        change.decidedAt || null,
        change.createdAt,
      );
      return this;
    },
    values() {
      return selectChanges.all().map((row) => changeFromRow(row));
    },
  };

  const insertNonce = db.prepare('INSERT INTO owner_nonces (token, expires_at) VALUES (?, ?)');
  const selectNonce = db.prepare('SELECT expires_at FROM owner_nonces WHERE token = ?');
  const deleteNonce = db.prepare('DELETE FROM owner_nonces WHERE token = ?');

  const ownerNonces = {
    get(token) {
      const row = selectNonce.get(token);
      return row ? row.expires_at : undefined;
    },
    set(token, expiresAt) {
      deleteNonce.run(token);
      insertNonce.run(token, expiresAt);
      return this;
    },
    delete(token) {
      deleteNonce.run(token);
      return true;
    },
  };

  return {
    kind: 'durable',
    filePath,
    accounts,
    byPhone: {
      get(hmac) {
        const row = selectAccountByPhone.get(hmac);
        return row ? row.id : undefined;
      },
      set() {
        return this;
      },
    },
    sessions,
    challenges,
    directory,
    rate,
    changeRequests,
    ownerNonces,
    accountById(id) {
      return accounts.get(id);
    },
    accountByPhone(hmac) {
      return accountFromRow(selectAccountByPhone.get(hmac));
    },
    markCodeConsumed(phoneHmac, codeHash, at) {
      insertConsumed.run(phoneHmac, codeHash, at);
    },
    codeWasConsumed(phoneHmac, codeHash) {
      return Boolean(selectConsumed.get(phoneHmac, codeHash));
    },
    transaction,
    close() {
      db.close();
    },
  };
}

function assertPrivate(target, required) {
  const mode = fs.statSync(target).mode & 0o777;
  if ((mode & 0o077) !== 0 || (mode & required) !== required) throw storageError();
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      phone_hmac TEXT NOT NULL UNIQUE,
      access TEXT NOT NULL,
      phone_verified_at INTEGER,
      session_generation INTEGER NOT NULL,
      introduction TEXT NOT NULL,
      evidence_note TEXT NOT NULL,
      submitted_at INTEGER
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      csrf_token TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      idle_expires_at INTEGER NOT NULL
    );
    CREATE TABLE challenges (
      phone_hmac TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL
    );
    CREATE TABLE consumed_codes (
      phone_hmac TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      consumed_at INTEGER NOT NULL,
      PRIMARY KEY (phone_hmac, code_hash)
    );
    CREATE TABLE directory (
      phone_hmac TEXT PRIMARY KEY
    );
    CREATE TABLE rate_events (
      bucket_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE TABLE change_requests (
      id TEXT PRIMARY KEY,
      from_account_id TEXT NOT NULL,
      new_phone_hmac TEXT NOT NULL,
      proof_at INTEGER,
      decided_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE owner_nonces (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    INSERT INTO meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}');
  `);
}

function assertSchema(db) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (!row || row.value !== String(SCHEMA_VERSION)) throw storageError();
}

module.exports = { createDurableStore };
