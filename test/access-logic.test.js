'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawnSync } = require('child_process');
const path = require('path');
const { COPY } = require('../lib/copy');
const { decideAccess, applicantMessages } = require('../lib/decide');
const { createCourier } = require('../lib/delivery');
const { createChallengeService } = require('../lib/challenges');
const { createMemoryStore } = require('../lib/store');
const { replaceDirectory } = require('../lib/directory');
const { resolvePolicy, PROVISIONAL_POLICY, RELEASE_BLOCKS } = require('../lib/policy');
const { createAccessHandler } = require('../lib/access-handler');
const { createReviewServer } = require('../review/harness');
const { applicantView } = require('../lib/applicant-view');
const { isLegacyInvitePath } = require('../lib/legacy-invites');
const { canViewProtected, playbackAllowed } = require('../lib/gate');
const { phoneKey } = require('../lib/crypto-util');

const ROOT = path.join(__dirname, '..');
const PEPPER = 'unit-test-pepper-value';
const E164 = '+15555550100';

function tempStoragePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markvee-access-'));
  return path.join(dir, 'access.sqlite');
}

function setup(overrides = {}) {
  const store = createMemoryStore();
  let t = 10_000;
  const courier = createCourier({
    runtime: 'test',
    delivery: 'fake',
    allowTestDelivery: true,
    nodeEnv: 'test',
  });
  const policy = resolvePolicy({
    codeTtlMs: 1_000,
    maxAttempts: 5,
    minResendIntervalMs: 0,
    maxSendsPerWindow: 10,
    resendWindowMs: 100_000,
    attemptWindowMs: 5_000,
    maxIpAttempts: 30,
    ...overrides,
  }, 'test');
  const challenges = createChallengeService({
    store,
    courier,
    policy,
    pepper: PEPPER,
    now: () => t,
  });
  return {
    store,
    courier,
    challenges,
    policy,
    advance(ms) { t += ms; },
  };
}

test('directory match approves only a person who was never blocked', () => {
  assert.equal(decideAccess({ priorStatus: 'none', phoneMatched: true }).access, 'approved');
  assert.equal(decideAccess({ priorStatus: 'pending', phoneMatched: true }).access, 'approved');
  assert.equal(decideAccess({ priorStatus: 'none', phoneMatched: false }).access, 'pending');
  assert.equal(decideAccess({ priorStatus: 'approved', phoneMatched: false }).access, 'approved');
  for (const prior of ['denied', 'revoked', 'superseded']) {
    const decision = decideAccess({ priorStatus: prior, phoneMatched: true });
    assert.equal(decision.access, prior);
    assert.equal(decision.friendApproved, false);
  }
});

test('applicant copy does not reveal a contact match', () => {
  const pending = { phoneVerifiedAt: 1, access: 'pending' };
  const denied = { phoneVerifiedAt: 1, access: 'denied' };
  const revoked = { phoneVerifiedAt: 1, access: 'revoked' };
  const superseded = { phoneVerifiedAt: 1, access: 'superseded' };
  const approved = { phoneVerifiedAt: 1, access: 'approved' };
  assert.deepEqual(applicantMessages(null), []);
  assert.deepEqual(applicantMessages({ access: 'approved' }), []);
  assert.deepEqual(applicantMessages(approved), [COPY.phoneVerified, COPY.friendApproved]);
  const waiting = [COPY.phoneVerified, COPY.unmatchedQuestion, COPY.pendingReview];
  assert.deepEqual(applicantMessages(pending), waiting);
  assert.deepEqual(applicantMessages(denied), waiting);
  assert.deepEqual(applicantMessages(revoked), waiting);
  assert.deepEqual(applicantMessages(superseded), waiting);
  const dumped = JSON.stringify(waiting);
  assert.equal(dumped.includes('match'), false);
  assert.equal(dumped.includes('vcf'), false);
  assert.equal(dumped.includes('denied'), false);
  assert.equal(dumped.includes('revoked'), false);
  assert.equal(COPY.unmatchedQuestion.includes('\u2019'), true);
  assert.equal(COPY.pendingReview.includes('\u2019'), true);
});

test('future screen text drops anything outside the approved strings', () => {
  const view = applicantView([
    COPY.phoneVerified,
    'You matched a contact.',
    COPY.pendingReview,
    '+15555550100',
  ]);
  assert.deepEqual(view.text, [COPY.phoneVerified, COPY.pendingReview]);
  assert.equal(view.showApproved, false);
  assert.equal(view.showQuestion, false);
});

test('contact digests do not retain fictional numbers or names', () => {
  const store = createMemoryStore();
  const imported = replaceDirectory(store, PEPPER, [
    { displayName: 'Ada Example', phones: ['+1 555 555 0100', '5555550101'] },
    { displayName: 'Ada Example', phones: ['tel:+15555550100'] },
  ]);
  assert.equal(imported, 1);
  assert.equal([...store.directory].every((value) => /^[a-f0-9]{64}$/.test(value)), true);
  assert.equal(JSON.stringify([...store.directory]).includes('Ada'), false);
  assert.equal(JSON.stringify([...store.directory]).includes('+'), false);
  assert.equal(store.directory.has(phoneKey(PEPPER, '+15555550100')), true);
});

test('provisional limits cannot be weakened outside tests', () => {
  const weakened = resolvePolicy({
    maxAttempts: 1000,
    codeTtlMs: 999999999,
    minResendIntervalMs: 0,
    maxSendsPerWindow: 100,
    sessionAbsoluteTtlMs: 999999999,
  }, 'production');
  assert.equal(weakened.maxAttempts, PROVISIONAL_POLICY.maxAttempts);
  assert.equal(weakened.codeTtlMs, PROVISIONAL_POLICY.codeTtlMs);
  assert.equal(weakened.minResendIntervalMs, PROVISIONAL_POLICY.minResendIntervalMs);
  assert.equal(weakened.maxSendsPerWindow, PROVISIONAL_POLICY.maxSendsPerWindow);
  assert.equal(weakened.sessionAbsoluteTtlMs, PROVISIONAL_POLICY.sessionAbsoluteTtlMs);
  assert.equal(RELEASE_BLOCKS.some((line) => line.includes('not owner-approved')), true);
  assert.equal(RELEASE_BLOCKS.some((line) => line.includes('Do not merge')), true);
});

test('fake delivery is unavailable unless the test gate is explicit', async () => {
  const closed = [
    createCourier({ runtime: 'production', delivery: 'fake', allowTestDelivery: true, nodeEnv: 'development' }),
    createCourier({ runtime: 'development', delivery: 'fake', allowTestDelivery: true, nodeEnv: 'development' }),
    createCourier({ runtime: 'test', delivery: 'fake', allowTestDelivery: false, nodeEnv: 'test' }),
    createCourier({ runtime: 'test', delivery: 'fake', allowTestDelivery: true, nodeEnv: 'production' }),
  ];
  for (const courier of closed) {
    assert.equal(courier.mode, 'fail-closed');
    assert.equal(courier.takeCodeForTests, undefined);
    const result = await courier.send({ e164: E164, code: '111111' });
    assert.deepEqual(result, { delivered: false, reason: 'delivery_not_configured' });
  }
  const open = createCourier({
    runtime: 'test',
    delivery: 'fake',
    allowTestDelivery: true,
    nodeEnv: 'test',
  });
  assert.equal(open.mode, 'fake');
  assert.equal(open.takeCodeForTests(E164), null);
});

test('codes expire, replay, lock, and resend without being stored raw', async () => {
  const fx = setup();
  await fx.challenges.start({ e164: E164, ip: '203.0.113.4' });
  const code = fx.courier.takeCodeForTests(E164);
  assert.match(code, /^\d{6}$/);
  assert.equal(JSON.stringify([...fx.store.challenges.values()]).includes(code), false);

  fx.advance(999);
  assert.equal(fx.challenges.verify({ e164: E164, code, ip: '203.0.113.4' }).ok, true);
  assert.equal(fx.challenges.verify({ e164: E164, code, ip: '203.0.113.4' }).ok, false);

  await fx.challenges.start({ e164: E164, ip: '203.0.113.4' });
  const expiring = fx.courier.takeCodeForTests(E164);
  fx.advance(1_000);
  assert.equal(fx.challenges.verify({ e164: E164, code: expiring, ip: '203.0.113.4' }).ok, false);

  await fx.challenges.start({ e164: E164, ip: '203.0.113.8' });
  const locked = fx.courier.takeCodeForTests(E164);
  for (let i = 0; i < 5; i += 1) {
    assert.equal(fx.challenges.verify({ e164: E164, code: '000000', ip: '203.0.113.9' }).ok, false);
  }
  assert.equal(fx.challenges.verify({ e164: E164, code: locked, ip: '203.0.113.9' }).ok, false);

  const fresh = setup();
  await fresh.challenges.start({ e164: E164, ip: '203.0.113.4' });
  const good = fresh.courier.takeCodeForTests(E164);
  for (let i = 0; i < 4; i += 1) {
    assert.equal(fresh.challenges.verify({ e164: E164, code: '999999', ip: '203.0.113.4' }).ok, false);
  }
  assert.equal(fresh.challenges.verify({ e164: E164, code: good, ip: '203.0.113.4' }).ok, true);
});

test('resend replaces the previous code and then stops', async () => {
  const fx = setup({ minResendIntervalMs: 1_000, maxSendsPerWindow: 3, codeTtlMs: 100_000 });
  await fx.challenges.start({ e164: E164, ip: '203.0.113.4' });
  const first = fx.courier.takeCodeForTests(E164);
  await fx.challenges.start({ e164: E164, ip: '203.0.113.4' });
  assert.equal(fx.courier.sentCount(), 1);
  fx.advance(1_000);
  await fx.challenges.start({ e164: E164, ip: '203.0.113.4' });
  const second = fx.courier.takeCodeForTests(E164);
  assert.notEqual(first, second);
  assert.equal(fx.challenges.verify({ e164: E164, code: first, ip: '198.51.100.2' }).ok, false);
  fx.advance(1_000);
  await fx.challenges.start({ e164: E164, ip: '203.0.113.4' });
  const third = fx.courier.takeCodeForTests(E164);
  fx.advance(1_000);
  await fx.challenges.start({ e164: E164, ip: '203.0.113.4' });
  assert.equal(fx.courier.sentCount(), 3);
  assert.equal(fx.challenges.verify({ e164: E164, code: third, ip: '198.51.100.2' }).ok, true);
});

test('ip attempt cap blocks a later correct code until the window passes', async () => {
  const fx = setup({ maxIpAttempts: 2, maxAttempts: 5, codeTtlMs: 100_000, attemptWindowMs: 5_000 });
  await fx.challenges.start({ e164: E164, ip: '203.0.113.4' });
  const code = fx.courier.takeCodeForTests(E164);
  assert.equal(fx.challenges.verify({ e164: E164, code: '111111', ip: '203.0.113.4' }).ok, false);
  assert.equal(fx.challenges.verify({ e164: E164, code: '222222', ip: '203.0.113.4' }).ok, false);
  assert.equal(fx.challenges.verify({ e164: E164, code, ip: '203.0.113.4' }).ok, false);
  fx.advance(5_000);
  assert.equal(fx.challenges.verify({ e164: E164, code, ip: '203.0.113.4' }).ok, true);
});

test('viewing requires active approval and playback is never allowed', () => {
  assert.equal(playbackAllowed(), false);
  assert.equal(canViewProtected(null), false);
  assert.equal(canViewProtected({ phoneVerifiedAt: 1, access: 'pending' }), false);
  assert.equal(canViewProtected({ phoneVerifiedAt: 1, access: 'denied' }), false);
  assert.equal(canViewProtected({ phoneVerifiedAt: 1, access: 'revoked' }), false);
  assert.equal(canViewProtected({ access: 'approved' }), false);
  assert.equal(canViewProtected({ phoneVerifiedAt: 1, access: 'approved' }), true);
});

test('legacy invite paths are recognized and ordinary routes are not', () => {
  for (const pathname of ['/invite', '/invite/abc', '/api/invite', '/api/friends/accept', '/join/now', '/r/abc', '/i/abc']) {
    assert.equal(isLegacyInvitePath(pathname), true, pathname);
  }
  const decoded = new URL('/%69nvite/abc', 'http://markvee.invalid').pathname;
  assert.equal(isLegacyInvitePath(decoded), true);
  for (const pathname of ['/api/posts', '/media/fx-artwork-1', '/api/access/phone/verify', '/invitation']) {
    assert.equal(isLegacyInvitePath(pathname), false, pathname);
  }
  assert.equal(isLegacyInvitePath('%E0%A'), false);
});

test('production handler fail-closes and clamps limits', async () => {
  const handler = createAccessHandler({
    runtime: 'production',
    delivery: 'fake',
    allowTestDelivery: true,
    pepper: 'production-pepper-value',
    sessionSecret: 'production-session-value',
    ownerToken: 'production-owner-token',
    siteOrigin: 'https://markvee.org',
    storagePath: tempStoragePath(),
    now: () => 1_700_000_000_000,
    policy: { maxAttempts: 1000, codeTtlMs: 99_999_999, minResendIntervalMs: 0 },
  });
  assert.equal(handler.store.kind, 'durable');
  assert.equal(handler.courier.mode, 'fail-closed');
  assert.equal(handler.courier.takeCodeForTests, undefined);
  assert.equal(handler.policy.maxAttempts, PROVISIONAL_POLICY.maxAttempts);
  assert.equal(handler.runtime, 'production');
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const started = await fetch(`http://127.0.0.1:${port}/api/access/phone/start`, {
      method: 'POST',
      headers: {
        origin: 'https://markvee.org',
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ phone: E164 }),
    });
    assert.equal(await started.text(), '{"ok":true}');
    assert.equal(handler.store.challenges.size, 0);
    const verified = await fetch(`http://127.0.0.1:${port}/api/access/phone/verify`, {
      method: 'POST',
      headers: {
        origin: 'https://markvee.org',
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ phone: E164, code: '000000' }),
    });
    assert.equal(verified.status, 401);
    assert.equal(await verified.text(), '{"ok":false}');
    assert.equal(handler.store.sessions.size, 0);
  } finally {
    handler.store.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('environment variables cannot open the fake courier', () => {
  const result = spawnSync(process.execPath, ['-e', `
    process.env.NODE_ENV = 'production';
    process.env.MARKVEE_DELIVERY = 'fake';
    const { createCourier } = require('./lib/delivery');
    const courier = createCourier({ runtime: 'test', delivery: 'fake', allowTestDelivery: true });
    if (courier.mode !== 'fail-closed') process.exit(2);
    if (typeof courier.takeCodeForTests === 'function') process.exit(3);
  `], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('test runtime defaults to the memory double', () => {
  const handler = createAccessHandler({
    runtime: 'test',
    pepper: 'test-pepper-not-for-production',
    sessionSecret: 'test-session-secret-value',
    ownerToken: 'test-owner-token-value',
    siteOrigin: 'https://markvee.org',
  });
  assert.equal(handler.store.kind, undefined);
  assert.equal(typeof handler.store.transaction, 'function');
});

test('non-test runtime refuses an in-memory store', () => {
  assert.throws(() => createAccessHandler({
    runtime: 'production',
    pepper: 'production-pepper-value',
    sessionSecret: 'production-session-value',
    ownerToken: 'production-owner-token',
    siteOrigin: 'https://markvee.org',
    store: createMemoryStore(),
  }), /storage unavailable/);
});

test('handler refuses to start without required secrets', () => {
  assert.throws(() => createAccessHandler({
    runtime: 'test',
    pepper: 'short',
    sessionSecret: 'test-session-secret-value',
    ownerToken: 'test-owner-token-value',
    siteOrigin: 'https://markvee.org',
  }), /missing pepper/);
  assert.throws(() => createAccessHandler({
    runtime: 'test',
    pepper: 'test-pepper-not-for-production',
    sessionSecret: 'test-session-secret-value',
    ownerToken: 'test-owner-token-value',
  }), /missing siteOrigin/);
});

test('omitted runtime fail-closes and a malformed target is rejected', async () => {
  const handler = createAccessHandler({
    pepper: 'test-pepper-not-for-production',
    sessionSecret: 'test-session-secret-value',
    ownerToken: 'test-owner-token-value',
    siteOrigin: 'https://markvee.org',
    storagePath: tempStoragePath(),
  });
  assert.equal(handler.runtime, 'development');
  assert.equal(handler.courier.mode, 'fail-closed');

  const res = {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; },
    end(body) { this.body = body ? body.toString() : ''; },
  };
  await handler({ url: 'http://[', method: 'GET', headers: {}, socket: {} }, res);
  assert.equal(res.status, 400);
  assert.equal(res.body, '{"ok":false}');

  const limited = {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; },
    end(body) { this.body = body ? body.toString() : ''; },
  };
  const { EventEmitter } = require('events');
  const req = new EventEmitter();
  req.url = '/api/access/phone/start';
  req.method = 'POST';
  req.headers = {
    origin: 'https://markvee.org',
    'content-type': 'application/json',
    'sec-fetch-site': 'same-origin',
  };
  req.socket = { remoteAddress: '203.0.113.10' };
  req.destroy = () => {};
  setImmediate(() => {
    req.emit('data', Buffer.alloc(40_000, 0x61));
  });
  await handler(req, limited);
  assert.equal(limited.status, 413);
  assert.equal(limited.body, '{"ok":false}');
  handler.store.close();
});

test('review harness refuses production and a server that is not ready', async () => {
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => createReviewServer(), /refuses production/);
  } finally {
    if (prior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prior;
  }

  const review = createReviewServer();
  const early = { status: 0, writeHead(status) { this.status = status; }, end() {} };
  review.server.emit('request', { url: '/', method: 'GET', headers: {} }, early);
  assert.equal(early.status, 503);

  const broken = createReviewServer({ pepper: 'short' });
  await assert.rejects(() => broken.listen(), /missing pepper/);
  await broken.close();
});

test('production environment selects the production runtime when unset', () => {
  const result = spawnSync(process.execPath, ['-e', `
    process.env.NODE_ENV = 'production';
    const { createAccessHandler } = require('./lib/access-handler');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markvee-prod-'));
    const handler = createAccessHandler({
      pepper: 'production-pepper-value',
      sessionSecret: 'production-session-value',
      ownerToken: 'production-owner-token',
      siteOrigin: 'https://markvee.org',
      storagePath: path.join(dir, 'access.sqlite'),
    });
    if (handler.runtime !== 'production') process.exit(2);
    if (handler.courier.mode !== 'fail-closed') process.exit(3);
    if (handler.store.kind !== 'durable') process.exit(4);
    handler.store.close();
  `], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
