'use strict';

/**
 * Isolated access boundary for review and tests.
 * Not mounted by server.js. Portal source parity failed, so this is not a
 * drop-in replacement for the deployed markvee-portal or markvee-site worker.
 * No playback, no LAN proxy, no raw RPC, and no production code delivery.
 */

const fs = require('fs').promises;
const path = require('path');
const { resolvePolicy } = require('./policy');
const { assertSecret, phoneKey, randomId, safeEqual } = require('./crypto-util');
const { normalizePhone } = require('./phone');
const { parseVcf } = require('./vcf');
const { decideAccess, applicantMessages } = require('./decide');
const { createCourier } = require('./delivery');
const { createChallengeService } = require('./challenges');
const {
  clearSessionCookie,
  issueSession,
  loadSession,
} = require('./sessions');
const { isLegacyInvitePath } = require('./legacy-invites');
const {
  PRIVATE_NO_STORE,
  canViewProtected,
  isPlaybackRequest,
} = require('./gate');
const { createMemoryStore, createAccount } = require('./store');
const { replaceDirectory } = require('./directory');

const PUBLIC_FILES = new Map([
  ['/', 'index.html'],
  ['/style.css', 'style.css'],
  ['/script.js', 'script.js'],
]);

const PUBLIC_TYPES = {
  'index.html': 'text/html; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
  'script.js': 'application/javascript; charset=utf-8',
};

const NOT_FOUND_BODY = Buffer.from('Not found\n');
const JSON_LIMIT = 32_000;
const VCF_LIMIT = 1_000_000;

function createAccessHandler(opts) {
  const runtime = resolveRuntime(opts);
  assertSecret('pepper', opts.pepper);
  assertSecret('sessionSecret', opts.sessionSecret);
  assertSecret('ownerToken', opts.ownerToken);
  if (!opts.siteOrigin || typeof opts.siteOrigin !== 'string') {
    throw new Error('missing siteOrigin');
  }

  const policy = resolvePolicy(opts.policy, runtime);
  const store = opts.store || createMemoryStore();
  const now = opts.now || Date.now;
  const courier = createCourier({
    runtime,
    delivery: opts.delivery,
    allowTestDelivery: opts.allowTestDelivery,
  });
  const challenges = createChallengeService({
    store,
    courier,
    policy,
    pepper: opts.pepper,
    now,
  });
  const publicDir = opts.publicDir || path.join(__dirname, '..', 'public');
  const media = opts.media || new Map();
  const posts = Array.isArray(opts.posts) ? opts.posts : [];

  async function handler(req, res) {
    try {
      await route(req, res);
    } catch (err) {
      if (res.headersSent) return;
      if (err && err.code === 'LIMIT') {
        json(res, 413, { ok: false });
        return;
      }
      if (err && err.code === 'JSON') {
        json(res, 400, { ok: false });
        return;
      }
      json(res, 500, { ok: false });
    }
  }

  async function route(req, res) {
    let urlObj;
    try {
      urlObj = new URL(req.url, 'http://markvee.invalid');
    } catch {
      json(res, 400, { ok: false });
      return;
    }
    const pathname = urlObj.pathname;

    if (isPlaybackRequest(urlObj)) {
      json(res, 403, { ok: false });
      return;
    }
    if (isLegacyInvitePath(pathname)) {
      notFound(res, req.method);
      return;
    }

    if (req.method === 'GET' && PUBLIC_FILES.has(pathname)) {
      await servePublic(res, pathname);
      return;
    }

    if (pathname === '/api/access/status' && req.method === 'GET') {
      status(req, res);
      return;
    }
    if (pathname === '/api/access/phone/start' && req.method === 'POST') {
      await startPhone(req, res);
      return;
    }
    if (pathname === '/api/access/phone/verify' && req.method === 'POST') {
      await verifyPhone(req, res);
      return;
    }
    if (pathname === '/api/access/introduction' && req.method === 'POST') {
      await introduction(req, res);
      return;
    }
    if (pathname === '/api/access/logout' && req.method === 'POST') {
      logout(req, res);
      return;
    }
    if (pathname === '/api/access/number-change' && req.method === 'POST') {
      await requestNumberChange(req, res);
      return;
    }
    if (pathname === '/api/access/number-change/prove' && req.method === 'POST') {
      await proveNumberChange(req, res);
      return;
    }

    if (pathname === '/api/owner/csrf' && req.method === 'GET') {
      ownerCsrf(req, res);
      return;
    }
    if (pathname === '/api/owner/queue' && req.method === 'GET') {
      ownerQueue(req, res);
      return;
    }
    if (pathname === '/api/owner/contacts/import' && req.method === 'POST') {
      await importContacts(req, res);
      return;
    }

    const accountAction = pathname.match(/^\/api\/owner\/accounts\/([A-Za-z0-9_-]{8,200})\/(approve|deny|revoke|restore)$/);
    if (accountAction && req.method === 'POST') {
      await ownerAccountAction(req, res, accountAction[1], accountAction[2]);
      return;
    }
    const changeAction = pathname.match(/^\/api\/owner\/number-changes\/([A-Za-z0-9_-]{8,200})\/approve$/);
    if (changeAction && req.method === 'POST') {
      await approveNumberChange(req, res, changeAction[1]);
      return;
    }

    if (pathname === '/api/posts' && req.method === 'GET') {
      protectedJson(req, res, { posts });
      return;
    }
    if (pathname === '/api/artwork' && req.method === 'GET') {
      protectedJson(req, res, { artwork: [...media.keys()] });
      return;
    }
    const asset = pathname.match(/^\/(?:media|artwork)\/([A-Za-z0-9_-]{1,64})$/);
    if (asset && (req.method === 'GET' || req.method === 'HEAD')) {
      serveMedia(req, res, asset[1]);
      return;
    }

    notFound(res, req.method);
  }

  function clientIp(req) {
    return (req.socket && req.socket.remoteAddress) || 'unknown';
  }

  function currentSession(req, slide) {
    return loadSession(store, req, opts.sessionSecret, policy, now, slide);
  }

  function status(req, res) {
    const loaded = currentSession(req, true);
    if (!loaded) {
      json(res, 200, { ok: true, messages: [] });
      return;
    }
    json(res, 200, {
      ok: true,
      messages: applicantMessages(loaded.account),
      csrfToken: loaded.session.csrfToken,
    });
  }

  async function startPhone(req, res) {
    const body = await readJson(req);
    const norm = normalizePhone(body && body.phone);
    if (norm.status === 'e164' && originAllowed(req)) {
      await challenges.start({ e164: norm.e164, ip: clientIp(req) });
    }
    json(res, 200, { ok: true });
  }

  async function verifyPhone(req, res) {
    const body = await readJson(req);
    if (!originAllowed(req)) {
      json(res, 403, { ok: false });
      return;
    }
    const norm = normalizePhone(body && body.phone);
    if (norm.status !== 'e164') {
      json(res, 401, { ok: false });
      return;
    }
    const result = challenges.verify({
      e164: norm.e164,
      code: body && body.code,
      ip: clientIp(req),
    });
    if (!result.ok) {
      json(res, 401, { ok: false });
      return;
    }
    const account = upsertVerifiedAccount(result.phoneHmac);
    const issued = issueSession(store, account, policy, now, opts.sessionSecret);
    json(res, 200, {
      ok: true,
      messages: applicantMessages(account),
      csrfToken: issued.csrfToken,
    }, [issued.cookie]);
  }

  function upsertVerifiedAccount(hmac) {
    const matched = store.directory.has(hmac);
    let account = store.accountByPhone(hmac);
    if (!account) {
      const decision = decideAccess({ priorStatus: 'none', phoneMatched: matched });
      account = createAccount(store, hmac, decision.access, now());
      return account;
    }
    const decision = decideAccess({ priorStatus: account.access, phoneMatched: matched });
    account.access = decision.access;
    account.phoneVerifiedAt = now();
    return account;
  }

  async function introduction(req, res) {
    const loaded = currentSession(req, true);
    if (!loaded || !loaded.account.phoneVerifiedAt) {
      json(res, 401, { ok: false });
      return;
    }
    if (!mutationAllowed(req, loaded.session)) {
      json(res, 403, { ok: false });
      return;
    }
    const body = await readJson(req);
    const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
    const evidence = typeof body.evidenceNote === 'string' ? body.evidenceNote.trim() : '';
    if (!answer || answer.length > 500 || evidence.length > 500) {
      json(res, 400, { ok: false });
      return;
    }
    if (loaded.account.access !== 'approved') {
      loaded.account.introduction = answer;
      loaded.account.evidenceNote = evidence;
      if (loaded.account.access === 'pending') loaded.account.submittedAt = now();
    }
    json(res, 200, { ok: true, messages: applicantMessages(loaded.account) });
  }

  function logout(req, res) {
    const loaded = currentSession(req, false);
    if (!loaded || !mutationAllowed(req, loaded.session)) {
      json(res, 403, { ok: false });
      return;
    }
    store.sessions.delete(loaded.session.id);
    json(res, 200, { ok: true, messages: [] }, [clearSessionCookie()]);
  }

  async function requestNumberChange(req, res) {
    const loaded = currentSession(req, true);
    if (!loaded || loaded.account.access !== 'approved') {
      json(res, 401, { ok: false });
      return;
    }
    if (!mutationAllowed(req, loaded.session)) {
      json(res, 403, { ok: false });
      return;
    }
    const body = await readJson(req);
    const norm = normalizePhone(body && body.phone);
    if (norm.status === 'e164') {
      const hmac = phoneKey(opts.pepper, norm.e164);
      if (hmac !== loaded.account.phoneHmac) {
        const id = randomId(16);
        store.changeRequests.set(id, {
          id,
          fromAccountId: loaded.account.id,
          newPhoneHmac: hmac,
          proofAt: null,
          decidedAt: null,
          createdAt: now(),
        });
      }
    }
    json(res, 200, { ok: true, messages: applicantMessages(loaded.account) });
  }

  async function proveNumberChange(req, res) {
    const body = await readJson(req);
    if (!originAllowed(req)) {
      json(res, 403, { ok: false });
      return;
    }
    const norm = normalizePhone(body && body.phone);
    if (norm.status !== 'e164') {
      json(res, 401, { ok: false });
      return;
    }
    const result = challenges.verify({
      e164: norm.e164,
      code: body && body.code,
      ip: clientIp(req),
    });
    if (!result.ok) {
      json(res, 401, { ok: false });
      return;
    }
    for (const change of store.changeRequests.values()) {
      if (change.newPhoneHmac === result.phoneHmac && !change.decidedAt) {
        change.proofAt = now();
      }
    }
    json(res, 200, { ok: true });
  }

  function ownerCsrf(req, res) {
    if (!ownerRequestAllowed(req, false)) {
      notFound(res, req.method);
      return;
    }
    const token = randomId(32);
    store.ownerNonces.set(token, now() + policy.ownerNonceTtlMs);
    json(res, 200, { csrfToken: token });
  }

  function ownerQueue(req, res) {
    if (!ownerRequestAllowed(req, false)) {
      notFound(res, req.method);
      return;
    }
    const accounts = [];
    for (const account of store.accounts.values()) {
      accounts.push({
        id: account.id,
        access: account.access,
        phoneVerified: Boolean(account.phoneVerifiedAt),
        introduction: account.introduction,
        evidenceNote: account.evidenceNote,
        submittedAt: account.submittedAt,
      });
    }
    const numberChanges = [];
    for (const change of store.changeRequests.values()) {
      if (change.decidedAt) continue;
      numberChanges.push({
        id: change.id,
        fromAccountId: change.fromAccountId,
        proofVerified: Boolean(change.proofAt),
      });
    }
    json(res, 200, { accounts, numberChanges });
  }

  async function importContacts(req, res) {
    if (!ownerRequestAllowed(req, true)) {
      ownerDenied(req, res);
      return;
    }
    const raw = await readBody(req, VCF_LIMIT);
    const text = raw.toString('utf8');
    const parsed = parseVcf(text);
    const imported = replaceDirectory(store, opts.pepper, parsed.contacts);
    json(res, 200, {
      ok: true,
      imported,
      skippedAmbiguous: parsed.skippedAmbiguous,
      skippedInvalid: parsed.skippedInvalid,
    });
  }

  async function ownerAccountAction(req, res, id, action) {
    if (!ownerRequestAllowed(req, true)) {
      ownerDenied(req, res);
      return;
    }
    await readBody(req, JSON_LIMIT);
    const account = store.accountById(id);
    if (!account) {
      json(res, 404, { ok: false });
      return;
    }
    const allowed = {
      approve: account.access === 'pending',
      deny: account.access === 'pending',
      revoke: account.access === 'approved',
      restore: account.access === 'denied' || account.access === 'revoked',
    };
    if (!allowed[action]) {
      json(res, 409, { ok: false });
      return;
    }
    if (action === 'approve') account.access = 'approved';
    if (action === 'deny') account.access = 'denied';
    if (action === 'revoke') account.access = 'revoked';
    if (action === 'restore') account.access = 'approved';
    if (action !== 'approve') account.sessionGeneration += 1;
    json(res, 200, { ok: true });
  }

  async function approveNumberChange(req, res, id) {
    if (!ownerRequestAllowed(req, true)) {
      ownerDenied(req, res);
      return;
    }
    await readBody(req, JSON_LIMIT);
    const change = store.changeRequests.get(id);
    const from = change && store.accountById(change.fromAccountId);
    if (!change || !from || change.decidedAt || !change.proofAt || from.access !== 'approved') {
      json(res, 409, { ok: false });
      return;
    }
    const dest = store.accountByPhone(change.newPhoneHmac);
    if (dest && dest.id !== from.id && dest.access === 'approved') {
      json(res, 409, { ok: false });
      return;
    }
    from.access = 'superseded';
    from.sessionGeneration += 1;
    if (!dest) {
      createAccount(store, change.newPhoneHmac, 'approved', change.proofAt);
    } else {
      dest.access = 'approved';
      dest.phoneVerifiedAt = change.proofAt;
      dest.sessionGeneration += 1;
    }
    change.decidedAt = now();
    json(res, 200, { ok: true });
  }

  function protectedJson(req, res, body) {
    const loaded = currentSession(req, true);
    if (!loaded || !canViewProtected(loaded.account)) {
      json(res, 404, { ok: false });
      return;
    }
    json(res, 200, body);
  }

  function serveMedia(req, res, id) {
    const loaded = currentSession(req, true);
    const item = media.get(id);
    if (!loaded || !canViewProtected(loaded.account) || !item) {
      notFound(res, req.method);
      return;
    }
    const headers = {
      ...PRIVATE_NO_STORE,
      'Content-Type': item.type || 'application/octet-stream',
      'Content-Length': item.body.length,
    };
    res.writeHead(req.method === 'HEAD' ? 200 : 200, headers);
    res.end(req.method === 'HEAD' ? undefined : item.body);
  }

  async function servePublic(res, pathname) {
    const name = PUBLIC_FILES.get(pathname);
    try {
      const body = await fs.readFile(path.join(publicDir, name));
      const headers = {
        ...PRIVATE_NO_STORE,
        'Content-Type': PUBLIC_TYPES[name],
        'Content-Length': body.length,
      };
      res.writeHead(200, headers);
      res.end(body);
    } catch {
      notFound(res, 'GET');
    }
  }

  function mutationAllowed(req, session) {
    if (!originAllowed(req)) return false;
    const header = req.headers['x-markvee-csrf'];
    if (typeof header !== 'string' || !session || !session.csrfToken) return false;
    return safeEqual(header, session.csrfToken);
  }

  function originAllowed(req) {
    if (req.headers.origin !== opts.siteOrigin) return false;
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
    return true;
  }

  function ownerRequestAllowed(req, consumeNonce) {
    if (!ownerAuthed(req) || !originAllowed(req)) return false;
    if (!consumeNonce) return true;
    const header = req.headers['x-markvee-csrf'];
    if (typeof header !== 'string') return false;
    const exp = store.ownerNonces.get(header);
    if (!exp) return false;
    store.ownerNonces.delete(header);
    return exp > now();
  }

  function ownerAuthed(req) {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(\S+)$/);
    const provided = match ? match[1] : '';
    if (!provided) return false;
    return safeEqual(provided, opts.ownerToken);
  }

  function ownerDenied(req, res) {
    if (!ownerAuthed(req)) {
      notFound(res, req.method);
      return;
    }
    json(res, 403, { ok: false });
  }

  handler.courier = courier;
  handler.store = store;
  handler.runtime = runtime;
  handler.policy = policy;
  return handler;
}

function resolveRuntime(opts) {
  if (opts.runtime === 'test' || opts.runtime === 'development' || opts.runtime === 'production') {
    return opts.runtime;
  }
  if (process.env.NODE_ENV === 'production') return 'production';
  return 'development';
}

function json(res, status, body, cookies) {
  const payload = Buffer.from(JSON.stringify(body));
  const headers = {
    ...PRIVATE_NO_STORE,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
  };
  if (cookies && cookies.length) headers['Set-Cookie'] = cookies;
  res.writeHead(status, headers);
  res.end(payload);
}

function notFound(res, method) {
  const headers = {
    ...PRIVATE_NO_STORE,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': method === 'HEAD' ? 0 : NOT_FOUND_BODY.length,
  };
  res.writeHead(404, headers);
  res.end(method === 'HEAD' ? undefined : NOT_FOUND_BODY);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('limit'), { code: 'LIMIT' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req, JSON_LIMIT);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    const err = new Error('json');
    err.code = 'JSON';
    throw err;
  }
}

module.exports = { createAccessHandler };
