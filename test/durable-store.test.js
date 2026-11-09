'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { createDurableStore } = require('../lib/durable-store');
const { createChallengeService } = require('../lib/challenges');
const { createCourier } = require('../lib/delivery');
const { createAccessHandler } = require('../lib/access-handler');
const { phoneKey } = require('../lib/crypto-util');

const PHONE = '+15555550100';
const PEPPER = 'durable-pepper-value-ok';
const NOW = 1_700_000_000_000;
const POLICY = {
  codeTtlMs: 60_000,
  maxAttempts: 5,
  minResendIntervalMs: 0,
  maxSendsPerWindow: 5,
  resendWindowMs: 60_000,
  attemptWindowMs: 60_000,
  maxIpAttempts: 10,
  sessionAbsoluteTtlMs: 60_000,
  sessionIdleTtlMs: 60_000,
  ownerNonceTtlMs: 60_000,
};

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markvee-durable-'));
  return { dir, file: path.join(dir, 'access.sqlite') };
}

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function call(server, pathname, options = {}) {
  const { port } = server.address();
  const headers = {
    origin: 'http://fixture.markvee.test',
    ...(options.headers || {}),
  };
  if (options.method && options.method !== 'GET' && !headers['sec-fetch-site']) {
    headers['sec-fetch-site'] = 'same-origin';
  }
  let body;
  if (options.body !== undefined) {
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    if (!headers['content-type']) {
      headers['content-type'] = typeof options.body === 'string' ? 'text/vcard' : 'application/json';
    }
  }
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: options.method || 'GET',
    headers,
    body,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { res, text, json };
}

test('revocation, logout, and consumed codes survive a restart', async () => {
  const { file } = tempFile();
  const first = createAccessHandler({
    runtime: 'test',
    delivery: 'fake',
    allowTestDelivery: true,
    storagePath: file,
    pepper: PEPPER,
    sessionSecret: 'durable-session-secret',
    ownerToken: 'durable-owner-token-value',
    siteOrigin: 'http://fixture.markvee.test',
    now: () => NOW,
    policy: POLICY,
    posts: [{ id: 'post-1', text: 'FICTIONAL_PRIVATE_POST' }],
  });
  const server = await listen(first);
  const imported = await call(server, '/api/owner/contacts/import', {
    method: 'POST',
    headers: {
      authorization: 'Bearer durable-owner-token-value',
      'x-markvee-csrf': (await call(server, '/api/owner/csrf', {
        headers: { authorization: 'Bearer durable-owner-token-value' },
      })).json.csrfToken,
    },
    body: 'BEGIN:VCARD\nFN:Ada Example\nTEL:+15555550100\nEND:VCARD',
  });
  assert.equal(imported.json.imported, 1);
  assert.equal(imported.text.includes(PHONE), false);

  await call(server, '/api/access/phone/start', { method: 'POST', body: { phone: PHONE } });
  const code = first.courier.takeCodeForTests(PHONE);
  const verified = await call(server, '/api/access/phone/verify', {
    method: 'POST',
    body: { phone: PHONE, code },
  });
  const cookie = verified.res.headers.getSetCookie()[0].split(';')[0];
  assert.equal(verified.json.messages[1], 'Friend access approved.');
  assert.equal((await call(server, '/api/posts', { headers: { cookie } })).res.status, 200);

  const queue = await call(server, '/api/owner/queue', {
    headers: { authorization: 'Bearer durable-owner-token-value' },
  });
  const account = queue.json.accounts.find((item) => item.access === 'approved');
  const csrf = (await call(server, '/api/owner/csrf', {
    headers: { authorization: 'Bearer durable-owner-token-value' },
  })).json.csrfToken;
  assert.equal((await call(server, `/api/owner/accounts/${account.id}/revoke`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer durable-owner-token-value',
      'x-markvee-csrf': csrf,
    },
    body: {},
  })).res.status, 200);
  assert.equal((await call(server, '/api/posts', { headers: { cookie } })).res.status, 404);

  await call(server, '/api/access/phone/start', { method: 'POST', body: { phone: '+15555550177' } });
  const secondCode = first.courier.takeCodeForTests('+15555550177');
  const second = await call(server, '/api/access/phone/verify', {
    method: 'POST',
    body: { phone: '+15555550177', code: secondCode },
  });
  const secondCookie = second.res.headers.getSetCookie()[0].split(';')[0];
  const secondCsrf = second.json.csrfToken;
  assert.equal((await call(server, '/api/access/logout', {
    method: 'POST',
    headers: { cookie: secondCookie, 'x-markvee-csrf': secondCsrf },
  })).res.status, 200);

  first.store.close();
  await new Promise((resolve) => server.close(resolve));

  const raw = fs.readFileSync(file);
  assert.equal(raw.includes(Buffer.from(PHONE)), false);
  assert.equal(raw.includes(Buffer.from('15555550100')), false);
  assert.equal(raw.includes(Buffer.from(code)), false);
  assert.equal(raw.includes(Buffer.from(secondCode)), false);
  assert.equal((fs.statSync(file).mode & 0o777), 0o600);
  assert.equal((fs.statSync(path.dirname(file)).mode & 0o777), 0o700);

  const restarted = createAccessHandler({
    runtime: 'test',
    delivery: 'fake',
    allowTestDelivery: true,
    storagePath: file,
    pepper: PEPPER,
    sessionSecret: 'durable-session-secret',
    ownerToken: 'durable-owner-token-value',
    siteOrigin: 'http://fixture.markvee.test',
    now: () => NOW,
    policy: POLICY,
    posts: [{ id: 'post-1', text: 'FICTIONAL_PRIVATE_POST' }],
  });
  const again = await listen(restarted);
  try {
    assert.equal(restarted.store.accountByPhone(phoneKey(PEPPER, PHONE)).access, 'revoked');
    assert.equal((await call(again, '/api/posts', { headers: { cookie } })).res.status, 404);
    assert.equal((await call(again, '/api/posts', { headers: { cookie: secondCookie } })).res.status, 404);
    const replay = await call(again, '/api/access/phone/verify', {
      method: 'POST',
      body: { phone: PHONE, code },
    });
    assert.equal(replay.res.status, 401);
    assert.equal(replay.res.headers.getSetCookie().length, 0);
    await call(again, '/api/access/phone/start', { method: 'POST', body: { phone: PHONE } });
    const fresh = restarted.courier.takeCodeForTests(PHONE);
    const resigned = await call(again, '/api/access/phone/verify', {
      method: 'POST',
      body: { phone: PHONE, code: fresh },
    });
    assert.equal(resigned.json.messages.includes('Friend access approved.'), false);
    assert.equal((await call(again, '/api/posts', {
      headers: { cookie: resigned.res.headers.getSetCookie()[0].split(';')[0] },
    })).text.includes('FICTIONAL_PRIVATE_POST'), false);
  } finally {
    restarted.store.close();
    await new Promise((resolve) => again.close(resolve));
  }
});

test('a crashed write rolls back and corrupt or exposed files fail closed', () => {
  const { dir, file } = tempFile();
  const store = createDurableStore(file);
  assert.throws(() => store.transaction(() => {
    store.accounts.set('acct-crash', {
      id: 'acct-crash',
      phoneHmac: 'ab'.repeat(32),
      access: 'revoked',
      phoneVerifiedAt: NOW,
      sessionGeneration: 3,
      introduction: '',
      evidenceNote: '',
      submittedAt: null,
    });
    throw new Error('crash');
  }), /crash/);
  store.close();
  const reopened = createDurableStore(file);
  assert.equal(reopened.accountById('acct-crash'), null);
  reopened.accounts.set('acct-kept', {
    id: 'acct-kept',
    phoneHmac: 'cd'.repeat(32),
    access: 'denied',
    phoneVerifiedAt: NOW,
    sessionGeneration: 4,
    introduction: '',
    evidenceNote: '',
    submittedAt: null,
  });
  reopened.close();
  const kept = createDurableStore(file);
  assert.equal(kept.accountById('acct-kept').access, 'denied');
  kept.close();

  fs.chmodSync(file, 0o644);
  assert.throws(() => createDurableStore(file), /storage unavailable/);
  assert.equal(fs.readFileSync(file).length > 0, true);
  fs.chmodSync(file, 0o600);

  fs.writeFileSync(file, 'this is not a database');
  fs.chmodSync(file, 0o600);
  assert.throws(() => createDurableStore(file), /storage unavailable/);
  assert.equal(fs.readFileSync(file).toString('utf8'), 'this is not a database');

  const foreign = path.join(dir, 'foreign.sqlite');
  const other = new DatabaseSync(foreign);
  other.exec('CREATE TABLE other (id INTEGER)');
  other.close();
  fs.chmodSync(foreign, 0o600);
  assert.throws(() => createDurableStore(foreign), /storage unavailable/);

  const blocker = path.join(dir, 'not-a-directory');
  fs.writeFileSync(blocker, 'x');
  fs.chmodSync(blocker, 0o600);
  assert.throws(() => createDurableStore(path.join(blocker, 'access.sqlite')), /storage unavailable/);
});

test('one consumed code cannot be spent twice under concurrent opens', async () => {
  const { file } = tempFile();
  const store = createDurableStore(file);
  const courier = createCourier({
    runtime: 'test',
    delivery: 'fake',
    allowTestDelivery: true,
    nodeEnv: 'test',
  });
  const challenges = createChallengeService({
    store,
    courier,
    policy: POLICY,
    pepper: PEPPER,
    now: () => NOW,
  });
  await challenges.start({ e164: PHONE, ip: '203.0.113.9' });
  const code = courier.takeCodeForTests(PHONE);
  store.close();

  function consume(ip) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(__dirname, '..', 'test-helpers', 'consume-child.js')], {
        env: {
          ...process.env,
          MARKVEE_CONSUME_CHILD: '1',
          MARKVEE_STORE: file,
          MARKVEE_POLICY: JSON.stringify(POLICY),
          MARKVEE_PEPPER: PEPPER,
          MARKVEE_NOW: String(NOW),
          MARKVEE_E164: PHONE,
          MARKVEE_CODE: code,
          MARKVEE_IP: ip,
        },
        stdio: 'ignore',
      });
      child.on('error', reject);
      child.on('exit', (status) => resolve(status));
    });
  }

  const results = await Promise.all([
    consume('203.0.113.20'),
    consume('203.0.113.21'),
  ]);
  assert.deepEqual(results.filter((status) => status === 0), [0]);
  const after = createDurableStore(file);
  try {
    assert.equal(after.challenges.size, 0);
    assert.equal(after.codeWasConsumed(phoneKey(PEPPER, PHONE), require('../lib/crypto-util').codeHash(
      PEPPER,
      phoneKey(PEPPER, PHONE),
      code,
    )), true);
    assert.equal(fs.readFileSync(file).includes(Buffer.from(code)), false);
  } finally {
    after.close();
  }
});

test('supersession, sessions, and a failed send stay durable', async () => {
  const { file } = tempFile();
  const store = createDurableStore(file);
  store.accounts.set('old-account', {
    id: 'old-account',
    phoneHmac: 'ab'.repeat(32),
    access: 'approved',
    phoneVerifiedAt: NOW,
    sessionGeneration: 1,
    introduction: '',
    evidenceNote: '',
    submittedAt: null,
  });
  store.changeRequests.set('change-1', {
    id: 'change-1',
    fromAccountId: 'old-account',
    newPhoneHmac: 'cd'.repeat(32),
    proofAt: null,
    decidedAt: null,
    createdAt: NOW,
  });
  store.changeRequests.get('change-1').proofAt = NOW;
  store.sessions.set('session-1', {
    id: 'session-1',
    accountId: 'old-account',
    generation: 1,
    csrfToken: 'csrf-token-not-a-phone',
    createdAt: NOW,
    expiresAt: NOW + 1000,
    idleExpiresAt: NOW + 1000,
  });
  store.sessions.get('session-1').idleExpiresAt = NOW + 400;
  assert.equal(store.byPhone.get('ab'.repeat(32)), 'old-account');
  store.directory.add('ef'.repeat(32));
  assert.equal(store.directory.has('ef'.repeat(32)), true);
  store.directory.delete('ef'.repeat(32));
  assert.equal([...store.directory].includes('ef'.repeat(32)), false);
  store.close();

  const again = createDurableStore(file);
  assert.equal(again.changeRequests.get('change-1').proofAt, NOW);
  assert.equal(again.sessions.get('session-1').idleExpiresAt, NOW + 400);
  again.accountById('old-account').access = 'superseded';
  again.accountById('old-account').sessionGeneration += 1;
  again.sessions.delete('session-1');
  again.close();

  const third = createDurableStore(file);
  assert.equal(third.accountById('old-account').access, 'superseded');
  assert.equal(third.accountById('old-account').sessionGeneration, 2);
  assert.equal(third.sessions.get('session-1'), null);
  third.close();

  const fresh = createDurableStore(file);
  const challenges = createChallengeService({
    store: fresh,
    courier: { async send() { throw new Error('down'); } },
    policy: POLICY,
    pepper: PEPPER,
    now: () => NOW,
  });
  await challenges.start({ e164: PHONE, ip: '203.0.113.30' });
  assert.equal(fresh.challenges.size, 0);
  fresh.close();
});

test('refuses a non-file store location', () => {
  assert.throws(() => createDurableStore(''), /storage unavailable/);
  assert.throws(() => createDurableStore(':memory:'), /storage unavailable/);
});

test('a closed store fails closed without an error detail', async () => {
  const { file } = tempFile();
  const handler = createAccessHandler({
    runtime: 'test',
    delivery: 'fake',
    allowTestDelivery: true,
    storagePath: file,
    pepper: PEPPER,
    sessionSecret: 'durable-session-secret',
    ownerToken: 'durable-owner-token-value',
    siteOrigin: 'http://fixture.markvee.test',
    now: () => NOW,
    policy: POLICY,
  });
  const server = await listen(handler);
  handler.store.close();
  try {
    const out = await call(server, '/api/owner/queue', {
      headers: { authorization: 'Bearer durable-owner-token-value' },
    });
    assert.equal(out.res.status, 503);
    assert.equal(out.text, '{"ok":false}');
    assert.equal(out.res.headers.get('cache-control').includes('no-store'), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
