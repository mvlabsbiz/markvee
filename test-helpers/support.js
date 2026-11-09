'use strict';

const assert = require('node:assert/strict');
const { createReviewServer } = require('../review/harness');

const OWNER = 'test-owner-token-value';
const ADA = '+15555550100';
const UNMATCHED = '+15555550199';
const NEXT = '+15555550188';

const FAST_POLICY = {
  codeTtlMs: 60_000,
  maxAttempts: 5,
  minResendIntervalMs: 0,
  maxSendsPerWindow: 30,
  resendWindowMs: 120_000,
  attemptWindowMs: 120_000,
  maxIpAttempts: 50,
  sessionAbsoluteTtlMs: 120_000,
  sessionIdleTtlMs: 60_000,
  ownerNonceTtlMs: 120_000,
};

const MEDIA_ID = 'fx-artwork-1';
const MEDIA_BODY = Buffer.from('FICTIONAL_MEDIA_BYTES');
const POST_TEXT = 'FICTIONAL_PRIVATE_POST';

function makeClock(start = 1_700_000_000_000) {
  const state = { t: start };
  return { state, now: () => state.t };
}

async function boot(overrides = {}) {
  const clk = overrides.clock || makeClock();
  const review = createReviewServer({
    now: clk.now,
    policy: overrides.policy || FAST_POLICY,
    media: overrides.media || new Map([[MEDIA_ID, { body: MEDIA_BODY, type: 'application/octet-stream' }]]),
    posts: overrides.posts || [{ id: 'post-1', text: POST_TEXT }],
    ownerToken: OWNER,
    publicDir: overrides.publicDir,
  });
  const started = await review.listen();
  return { ...started, review, clk, owner: OWNER };
}

function createJar() {
  let value = '';
  return {
    store(res) {
      const list = res.headers.getSetCookie();
      if (!list.length) return;
      const pair = list[0].split(';')[0];
      value = pair.slice(pair.indexOf('=') + 1);
    },
    header() {
      return value ? `__Host-markvee_session=${value}` : '';
    },
    saved() {
      return value ? `__Host-markvee_session=${value}` : '';
    },
  };
}

async function api(ctx, pathname, options = {}) {
  const method = options.method || 'GET';
  const headers = { ...(options.headers || {}) };
  if (options.origin !== null) headers.origin = options.origin || ctx.origin;
  if (options.csrf) headers['x-markvee-csrf'] = options.csrf;
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (!headers['sec-fetch-site'] && method !== 'GET') headers['sec-fetch-site'] = 'same-origin';
  const cookie = options.cookie !== undefined ? options.cookie : (options.jar ? options.jar.header() : '');
  if (cookie) headers.cookie = cookie;
  let body;
  if (options.body !== undefined) {
    if (typeof options.body === 'string') {
      body = options.body;
      if (!headers['content-type']) headers['content-type'] = 'text/vcard';
    } else {
      body = JSON.stringify(options.body);
      headers['content-type'] = 'application/json';
    }
  }
  const res = await fetch(ctx.origin + pathname, { method, headers, body });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { res, text, json };
}

async function ownerCsrf(ctx) {
  const out = await api(ctx, '/api/owner/csrf', { token: ctx.owner });
  assert.equal(out.res.status, 200);
  assert.equal(typeof out.json.csrfToken, 'string');
  return out.json.csrfToken;
}

async function importDirectory(ctx, vcf) {
  const csrf = await ownerCsrf(ctx);
  return api(ctx, '/api/owner/contacts/import', {
    method: 'POST',
    token: ctx.owner,
    csrf,
    body: vcf,
  });
}

async function provePhone(ctx, phone, jar) {
  const { normalizePhone } = require('../lib/phone');
  const start = await api(ctx, '/api/access/phone/start', {
    method: 'POST',
    body: { phone },
  });
  const norm = normalizePhone(phone);
  const code = ctx.courier.takeCodeForTests(norm.status === 'e164' ? norm.e164 : phone);
  const verified = await api(ctx, '/api/access/phone/verify', {
    method: 'POST',
    jar,
    body: { phone, code },
  });
  if (jar) jar.store(verified.res);
  return { start, verified, code };
}

function assertPrivate(res) {
  assert.match(res.headers.get('cache-control'), /private/);
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.equal(res.headers.get('cdn-cache-control'), 'no-store');
  assert.equal(res.headers.get('surrogate-control'), 'no-store');
  assert.equal(res.headers.get('pragma'), 'no-cache');
  assert.match(res.headers.get('vary'), /Cookie/);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.notEqual(res.status, 304);
}

function assertNoSecrets(text, extras = []) {
  assert.equal(text.includes('1555555'), false);
  assert.equal(text.includes('phoneMatched'), false);
  assert.equal(text.includes('FICTIONAL_MEDIA_BYTES'), false);
  for (const extra of extras) assert.equal(text.includes(extra), false);
}

const SAMPLE_VCF = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN;ENCODING=QUOTED-PRINTABLE:Ada Ex=61mple',
  'TEL;TYPE=CELL:+1555',
  ' 5550100',
  'NOTE:ignore +19995550199',
  'END:VCARD',
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN:Local Example',
  'TEL;TYPE=HOME:555-555-0101',
  'END:VCARD',
].join('\r\n');

async function withServer(fn, overrides) {
  const logs = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const originals = Object.fromEntries(methods.map((name) => [name, console[name]]));
  for (const name of methods) {
    console[name] = (...args) => logs.push(args.map(String).join(' '));
  }
  let ctx;
  try {
    ctx = await boot(overrides);
    await fn(ctx);
    assert.deepEqual(logs, []);
  } finally {
    for (const name of methods) console[name] = originals[name];
    if (ctx) await ctx.review.close();
  }
}

module.exports = {
  OWNER,
  ADA,
  UNMATCHED,
  NEXT,
  FAST_POLICY,
  MEDIA_ID,
  MEDIA_BODY,
  POST_TEXT,
  SAMPLE_VCF,
  makeClock,
  boot,
  createJar,
  api,
  ownerCsrf,
  importDirectory,
  provePhone,
  assertPrivate,
  assertNoSecrets,
  withServer,
};
