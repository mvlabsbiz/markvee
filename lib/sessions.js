'use strict';

const crypto = require('crypto');
const { randomId, safeEqual } = require('./crypto-util');

const COOKIE_NAME = '__Host-markvee_session';

function sealSessionId(id, secret) {
  const sig = crypto.createHmac('sha256', secret).update(id).digest('base64url');
  return `${id}.${sig}`;
}

function openSessionId(value, secret) {
  if (typeof value !== 'string') return null;
  const idx = value.indexOf('.');
  if (idx < 20) return null;
  const id = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(id)) return null;
  const expected = crypto.createHmac('sha256', secret).update(id).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  return { id };
}

function sessionCookie(value, maxAgeSeconds) {
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

function clearSessionCookie() {
  return sessionCookie('', 0);
}

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return '';
}

function issueSession(store, account, policy, now, secret) {
  const t = now();
  const id = randomId(32);
  const csrfToken = randomId(32);
  const session = {
    id,
    accountId: account.id,
    generation: account.sessionGeneration,
    csrfToken,
    createdAt: t,
    expiresAt: t + policy.sessionAbsoluteTtlMs,
    idleExpiresAt: Math.min(
      t + policy.sessionAbsoluteTtlMs,
      t + policy.sessionIdleTtlMs,
    ),
  };
  store.sessions.set(id, session);
  const maxAge = Math.max(0, Math.floor(policy.sessionAbsoluteTtlMs / 1000));
  return {
    session,
    csrfToken,
    cookie: sessionCookie(sealSessionId(id, secret), maxAge),
  };
}

function loadSession(store, req, secret, policy, now, slide) {
  const opened = openSessionId(readCookie(req, COOKIE_NAME), secret);
  if (!opened) return null;
  const session = store.sessions.get(opened.id);
  if (!session) return null;
  const t = now();
  if (t >= session.expiresAt || t >= session.idleExpiresAt) return null;
  const account = store.accountById(session.accountId);
  if (!account || account.sessionGeneration !== session.generation) return null;
  if (slide) {
    session.idleExpiresAt = Math.min(session.expiresAt, t + policy.sessionIdleTtlMs);
  }
  return { session, account };
}

module.exports = {
  COOKIE_NAME,
  sealSessionId,
  openSessionId,
  clearSessionCookie,
  readCookie,
  issueSession,
  loadSession,
};
