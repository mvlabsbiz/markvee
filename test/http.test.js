'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { COPY } = require('../lib/copy');
const {
  ADA,
  UNMATCHED,
  NEXT,
  MEDIA_ID,
  MEDIA_BODY,
  POST_TEXT,
  SAMPLE_VCF,
  makeClock,
  createJar,
  api,
  ownerCsrf,
  importDirectory,
  provePhone,
  assertPrivate,
  assertNoSecrets,
  withServer,
} = require('../test-helpers/support');

const WAITING = [COPY.phoneVerified, COPY.unmatchedQuestion, COPY.pendingReview];
const APPROVED = [COPY.phoneVerified, COPY.friendApproved];
const CONDITIONAL = {
  'if-none-match': '"fx"',
  'if-modified-since': 'Tue, 15 Nov 1994 12:45:26 GMT',
};

function assertWaiting(json) {
  assert.deepEqual(json.messages, WAITING);
  assert.equal(JSON.stringify(json).includes('match'), false);
  assert.equal(JSON.stringify(json).includes('denied'), false);
  assert.equal(JSON.stringify(json).includes('revoked'), false);
  assert.equal(JSON.stringify(json).includes('vcf'), false);
}

async function accountByAccess(ctx, access) {
  const queue = await api(ctx, '/api/owner/queue', { token: ctx.owner });
  assert.equal(queue.res.status, 200);
  return queue.json.accounts.find((account) => account.access === access);
}

async function ownerPost(ctx, pathname) {
  const csrf = await ownerCsrf(ctx);
  return api(ctx, pathname, { method: 'POST', token: ctx.owner, csrf, body: {} });
}

test('signed-out public html has no protected activity', async () => {
  await withServer(async (ctx) => {
    const page = await api(ctx, '/', { headers: CONDITIONAL });
    const file = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'));
    assert.equal(page.res.status, 200);
    assert.equal(page.text, file.toString('utf8'));
    assertPrivate(page.res);
    assert.equal(page.text.includes(POST_TEXT), false);
    assert.equal(page.text.includes('FICTIONAL_MEDIA_BYTES'), false);
    assert.equal(page.text.includes(COPY.phoneVerified), false);
    assert.equal(page.text.includes('1555555'), false);

    const posts = await api(ctx, '/api/posts', { headers: CONDITIONAL });
    const artwork = await api(ctx, '/api/artwork', { headers: CONDITIONAL });
    const media = await api(ctx, `/media/${MEDIA_ID}`, { headers: CONDITIONAL });
    const head = await api(ctx, `/artwork/${MEDIA_ID}`, { method: 'HEAD' });
    for (const out of [posts, artwork]) {
      assert.equal(out.res.status, 404);
      assert.deepEqual(out.json, { ok: false });
      assertPrivate(out.res);
      assert.equal(out.text.includes(POST_TEXT), false);
    }
    assert.equal(media.res.status, 404);
    assert.equal(media.text, 'Not found\n');
    assert.equal(media.text.includes('FICTIONAL_MEDIA_BYTES'), false);
    assertPrivate(media.res);
    assert.equal(head.res.status, 404);
    assert.equal(head.text, '');
    assert.equal(head.res.headers.get('content-length'), '0');
    assert.notEqual(Number(head.res.headers.get('content-length')), MEDIA_BODY.length);

    const options = await api(ctx, '/api/posts', { method: 'OPTIONS' });
    assert.equal(options.res.headers.get('access-control-allow-origin'), null);
    assert.equal(options.text.includes(POST_TEXT), false);

    const status = await api(ctx, '/api/access/status');
    assert.deepEqual(status.json, { ok: true, messages: [] });
    assertPrivate(status.res);
    const foreign = await api(ctx, '/api/access/status', { cookie: 'noequals; other=1' });
    assert.deepEqual(foreign.json.messages, []);
  });
});

test('ambiguous numbers are not sent a code and explicit formats match one contact', async () => {
  await withServer(async (ctx) => {
    const imported = await importDirectory(ctx, SAMPLE_VCF);
    assert.equal(imported.res.status, 200);
    assert.deepEqual(imported.json, { ok: true, imported: 1, skippedAmbiguous: 1, skippedInvalid: 0 });
    assertNoSecrets(imported.text, ['Ada', 'Local']);

    const ambiguous = await api(ctx, '/api/access/phone/start', {
      method: 'POST',
      body: { phone: '15555550100' },
    });
    assert.deepEqual(ambiguous.json, { ok: true });
    assert.equal(ctx.courier.sentCount(), 0);
    const ambiguousVerify = await api(ctx, '/api/access/phone/verify', {
      method: 'POST',
      body: { phone: '15555550100', code: '123456' },
    });
    assert.equal(ambiguousVerify.res.status, 401);
    assert.deepEqual(ambiguousVerify.json, { ok: false });
    assert.equal(ambiguousVerify.res.headers.getSetCookie().length, 0);

    const crossSite = await api(ctx, '/api/access/phone/start', {
      method: 'POST',
      body: { phone: ADA },
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    assert.deepEqual(crossSite.json, { ok: true });
    assert.equal(ctx.courier.sentCount(), 0);

    const jar = createJar();
    const started = await api(ctx, '/api/access/phone/start', {
      method: 'POST',
      body: { phone: '00 1 555 555 0100' },
    });
    assert.deepEqual(started.json, { ok: true });
    assert.equal(started.text.includes('15555550100'), false);
    const code = ctx.courier.takeCodeForTests(ADA);
    assert.match(code, /^\d{6}$/);
    const wrongOrigin = await api(ctx, '/api/access/phone/verify', {
      method: 'POST',
      origin: 'https://evil.example',
      body: { phone: ADA, code },
    });
    assert.equal(wrongOrigin.res.status, 403);
    assert.equal(wrongOrigin.res.headers.getSetCookie().length, 0);
    const verified = await api(ctx, '/api/access/phone/verify', {
      method: 'POST',
      jar,
      body: { phone: '+1 (555) 555-0100 ext. 9', code },
    });
    jar.store(verified.res);
    assert.equal(verified.res.status, 200);
    assert.deepEqual(verified.json.messages, APPROVED);
    assert.equal(verified.text.includes(code), false);
    assert.equal(verified.text.includes('match'), false);
    assert.match(verified.res.headers.getSetCookie()[0], /__Host-markvee_session=/);
    assert.match(verified.res.headers.getSetCookie()[0], /HttpOnly/);
    assert.match(verified.res.headers.getSetCookie()[0], /Secure/);
    assert.match(verified.res.headers.getSetCookie()[0], /SameSite=Strict/);
    assert.match(verified.res.headers.getSetCookie()[0], /Path=\//);
    assert.doesNotMatch(verified.res.headers.getSetCookie()[0], /Domain=/);

    const replay = await api(ctx, '/api/access/phone/verify', {
      method: 'POST',
      body: { phone: ADA, code },
    });
    assert.equal(replay.res.status, 401);
    assert.deepEqual(replay.json, { ok: false });
    assert.equal(replay.res.headers.getSetCookie().length, 0);

    const posts = await api(ctx, '/api/posts', { jar, headers: CONDITIONAL });
    assert.equal(posts.res.status, 200);
    assert.equal(posts.json.posts[0].text, POST_TEXT);
    assertPrivate(posts.res);
    assert.equal(posts.res.headers.get('etag'), null);
    const bytes = await api(ctx, `/media/${MEDIA_ID}`, { jar });
    assert.equal(bytes.res.status, 200);
    assert.equal(bytes.text, 'FICTIONAL_MEDIA_BYTES');
    assertPrivate(bytes.res);
  });
});

test('phone-only applicants stay pending and do not see protected bytes', async () => {
  await withServer(async (ctx) => {
    const jar = createJar();
    const other = createJar();
    const first = await provePhone(ctx, UNMATCHED, jar);
    assert.equal(first.verified.res.status, 200);
    assertWaiting(first.verified.json);
    assert.equal(first.verified.text.includes(first.code), false);
    assert.equal(first.start.text.includes(UNMATCHED), false);

    const posts = await api(ctx, '/api/posts', { jar, headers: CONDITIONAL });
    const media = await api(ctx, `/artwork/${MEDIA_ID}`, { jar, headers: CONDITIONAL });
    const playback = await api(ctx, `/media/${MEDIA_ID}?playback=1`, { jar });
    assert.equal(posts.res.status, 404);
    assert.equal(posts.text.includes(POST_TEXT), false);
    assert.equal(media.res.status, 404);
    assert.equal(media.text, 'Not found\n');
    assert.equal(playback.res.status, 403);
    assert.deepEqual(playback.json, { ok: false });
    assert.equal(playback.text.includes('http'), false);
    assertPrivate(posts.res);

    const answer = 'FICTIONAL_NAME_TOKEN, from the fictional Tuesday club';
    const evidence = 'A social-page screenshot described by hand';
    const saved = await api(ctx, '/api/access/introduction', {
      method: 'POST',
      jar,
      csrf: first.verified.json.csrfToken,
      body: { answer, evidenceNote: evidence },
    });
    assertWaiting(saved.json);
    assert.equal(saved.text.includes(answer), false);
    const status = await api(ctx, '/api/access/status', { jar });
    assertWaiting(status.json);
    assert.equal(status.text.includes(answer), false);

    const stranger = await provePhone(ctx, NEXT, other);
    assertWaiting(stranger.verified.json);
    assert.equal(stranger.verified.text.includes(answer), false);

    const queue = await api(ctx, '/api/owner/queue', { token: ctx.owner });
    const applicant = queue.json.accounts.find((account) => account.introduction === answer);
    assert.equal(applicant.access, 'pending');
    assert.equal(applicant.phoneVerified, true);
    assert.equal(applicant.evidenceNote, evidence);
    assert.equal(JSON.stringify(queue.json).includes(UNMATCHED), false);
    assert.equal(JSON.stringify(queue.json).includes('match'), false);

    const hidden = await api(ctx, '/api/owner/queue');
    assert.equal(hidden.res.status, 404);
    assert.equal(hidden.text.includes(answer), false);
  });
});

test('denied and revoked numbers cannot regain access through a later match', async () => {
  await withServer(async (ctx) => {
    const deniedJar = createJar();
    const first = await provePhone(ctx, UNMATCHED, deniedJar);
    const introduced = await api(ctx, '/api/access/introduction', {
      method: 'POST',
      jar: deniedJar,
      csrf: first.verified.json.csrfToken,
      body: { answer: 'FICTIONAL_NAME_TOKEN from a fictional class' },
    });
    assertWaiting(introduced.json);
    const pending = await accountByAccess(ctx, 'pending');
    const denied = await ownerPost(ctx, `/api/owner/accounts/${pending.id}/deny`);
    assert.equal(denied.res.status, 200);
    const stale = await api(ctx, '/api/access/status', { jar: deniedJar });
    assert.deepEqual(stale.json.messages, []);
    const deniedAgain = await provePhone(ctx, UNMATCHED, createJar());
    assertWaiting(deniedAgain.verified.json);
    const media = await api(ctx, `/media/${MEDIA_ID}`, { jar: { header: () => '' } });
    assert.equal(media.text.includes('FICTIONAL_MEDIA_BYTES'), false);

    const imported = await importDirectory(ctx, `BEGIN:VCARD\nFN:Unmatched Example\nTEL:${UNMATCHED}\nEND:VCARD`);
    assert.equal(imported.json.imported, 1);
    const stillDenied = await provePhone(ctx, UNMATCHED, createJar());
    assertWaiting(stillDenied.verified.json);
    const blockedMedia = await api(ctx, `/media/${MEDIA_ID}`, {
      cookie: stillDenied.verified.res.headers.getSetCookie()[0].split(';')[0],
    });
    assert.equal(blockedMedia.res.status, 404);
    assert.equal(blockedMedia.text.includes('FICTIONAL_MEDIA_BYTES'), false);
    const illegal = await ownerPost(ctx, `/api/owner/accounts/${pending.id}/approve`);
    assert.equal(illegal.res.status, 409);
    const restored = await ownerPost(ctx, `/api/owner/accounts/${pending.id}/restore`);
    assert.equal(restored.res.status, 200);
    const back = await provePhone(ctx, UNMATCHED, createJar());
    assert.deepEqual(back.verified.json.messages, APPROVED);
    const allowed = await api(ctx, '/api/artwork', {
      cookie: back.verified.res.headers.getSetCookie()[0].split(';')[0],
    });
    assert.deepEqual(allowed.json.artwork, [MEDIA_ID]);

    const approvedJar = createJar();
    const second = createJar();
    await importDirectory(ctx, SAMPLE_VCF);
    const approved = await provePhone(ctx, ADA, approvedJar);
    assert.deepEqual(approved.verified.json.messages, APPROVED);
    const again = await provePhone(ctx, ADA, second);
    assert.equal((await api(ctx, '/api/posts', { jar: approvedJar })).res.status, 200);
    assert.equal((await api(ctx, '/api/posts', { jar: second })).res.status, 200);
    const roster = await api(ctx, '/api/owner/queue', { token: ctx.owner });
    const ada = roster.json.accounts.find((account) => account.access === 'approved' && account.id !== pending.id);
    assert.ok(ada);
    assert.equal((await ownerPost(ctx, `/api/owner/accounts/${ada.id}/revoke`)).res.status, 200);
    assert.equal((await api(ctx, '/api/posts', { jar: approvedJar })).res.status, 404);
    assert.equal((await api(ctx, '/api/posts', { jar: second })).res.status, 404);
    const revokedLogin = await provePhone(ctx, ADA, createJar());
    assertWaiting(revokedLogin.verified.json);
    assert.equal((await api(ctx, `/artwork/${MEDIA_ID}`, {
      cookie: revokedLogin.verified.res.headers.getSetCookie()[0].split(';')[0],
    })).text, 'Not found\n');
    const revoked = await accountByAccess(ctx, 'revoked');
    assert.equal((await ownerPost(ctx, `/api/owner/accounts/${revoked.id}/restore`)).res.status, 200);
    await importDirectory(ctx, 'BEGIN:VCARD\nEND:VCARD');
    const restoredAda = await provePhone(ctx, ADA, createJar());
    assert.deepEqual(restoredAda.verified.json.messages, APPROVED);
  });
});

test('logout drops one session and expiry drops an old cookie', async () => {
  await withServer(async (ctx) => {
    await importDirectory(ctx, SAMPLE_VCF);
    const first = createJar();
    const second = createJar();
    const a = await provePhone(ctx, ADA, first);
    const b = await provePhone(ctx, ADA, second);
    const kept = second.saved();
    const dropped = first.saved();
    const wrong = await api(ctx, '/api/access/logout', {
      method: 'POST',
      jar: first,
      csrf: b.verified.json.csrfToken,
    });
    assert.equal(wrong.res.status, 403);
    assert.equal((await api(ctx, '/api/posts', { cookie: dropped })).res.status, 200);
    const loggedOut = await api(ctx, '/api/access/logout', {
      method: 'POST',
      jar: first,
      csrf: a.verified.json.csrfToken,
    });
    assert.equal(loggedOut.res.status, 200);
    assert.match(loggedOut.res.headers.getSetCookie()[0], /Max-Age=0/);
    assert.equal((await api(ctx, '/api/posts', { cookie: dropped })).res.status, 404);
    assert.equal((await api(ctx, '/api/posts', { cookie: kept })).res.status, 200);
    const returned = await provePhone(ctx, ADA, createJar());
    assert.deepEqual(returned.verified.json.messages, APPROVED);
  });

  const clock = makeClock(5_000_000);
  await withServer(async (ctx) => {
    await importDirectory(ctx, SAMPLE_VCF);
    const jar = createJar();
    await provePhone(ctx, ADA, jar);
    clock.state.t += 5_000;
    assert.equal((await api(ctx, '/api/posts', { jar, headers: CONDITIONAL })).res.status, 404);
    assert.deepEqual((await api(ctx, '/api/access/status', { jar })).json.messages, []);
    const renewed = await provePhone(ctx, ADA, createJar());
    assert.deepEqual(renewed.verified.json.messages, APPROVED);
    clock.state.t += 4_000;
    assert.equal((await api(ctx, `/media/${MEDIA_ID}`, {
      cookie: renewed.verified.res.headers.getSetCookie()[0].split(';')[0],
    })).res.status, 200);
    clock.state.t = 5_000_000 + 5_000 + 20_000;
    assert.equal((await api(ctx, `/media/${MEDIA_ID}`, {
      cookie: renewed.verified.res.headers.getSetCookie()[0].split(';')[0],
      headers: CONDITIONAL,
    })).res.status, 404);
  }, {
    clock,
    policy: {
      codeTtlMs: 60_000,
      maxAttempts: 5,
      minResendIntervalMs: 0,
      maxSendsPerWindow: 10,
      resendWindowMs: 120_000,
      attemptWindowMs: 120_000,
      maxIpAttempts: 20,
      sessionAbsoluteTtlMs: 20_000,
      sessionIdleTtlMs: 5_000,
      ownerNonceTtlMs: 60_000,
    },
  });
});

test('expired codes fail and a number change needs owner review plus new proof', async () => {
  const clock = makeClock(9_000_000);
  await withServer(async (ctx) => {
    const started = await api(ctx, '/api/access/phone/start', {
      method: 'POST',
      body: { phone: ADA },
    });
    assert.deepEqual(started.json, { ok: true });
    const code = ctx.courier.takeCodeForTests(ADA);
    clock.state.t += 1_001;
    const expired = await api(ctx, '/api/access/phone/verify', {
      method: 'POST',
      body: { phone: ADA, code },
    });
    assert.equal(expired.res.status, 401);
    assert.equal(expired.res.headers.getSetCookie().length, 0);
    await importDirectory(ctx, SAMPLE_VCF);
    const jar = createJar();
    const ok = await provePhone(ctx, ADA, jar);
    assert.deepEqual(ok.verified.json.messages, APPROVED);

    const nextJar = createJar();
    const separate = await provePhone(ctx, NEXT, nextJar);
    assertWaiting(separate.verified.json);
    assert.equal((await api(ctx, '/api/posts', { jar: nextJar })).text.includes(POST_TEXT), false);

    const ada = await accountByAccess(ctx, 'approved');
    const requested = await api(ctx, '/api/access/number-change', {
      method: 'POST',
      jar,
      csrf: ok.verified.json.csrfToken,
      body: { phone: NEXT },
    });
    assert.deepEqual(requested.json.messages, APPROVED);
    assert.equal(requested.text.includes(NEXT), false);
    const early = await api(ctx, '/api/owner/queue', { token: ctx.owner });
    const change = early.json.numberChanges.find((item) => item.fromAccountId === ada.id);
    assert.equal(change.proofVerified, false);
    const tooSoon = await ownerPost(ctx, `/api/owner/number-changes/${change.id}/approve`);
    assert.equal(tooSoon.res.status, 409);
    assert.equal((await api(ctx, '/api/posts', { jar })).res.status, 200);

    const proofStart = await api(ctx, '/api/access/phone/start', {
      method: 'POST',
      body: { phone: NEXT },
    });
    assert.equal(proofStart.text.includes(NEXT), false);
    const proofCode = ctx.courier.takeCodeForTests(NEXT);
    const proved = await api(ctx, '/api/access/number-change/prove', {
      method: 'POST',
      body: { phone: NEXT, code: proofCode },
    });
    assert.deepEqual(proved.json, { ok: true });
    assert.equal(proved.res.headers.getSetCookie().length, 0);
    assert.equal((await api(ctx, '/api/posts', { jar: nextJar })).res.status, 404);

    const done = await ownerPost(ctx, `/api/owner/number-changes/${change.id}/approve`);
    assert.equal(done.res.status, 200);
    assert.equal((await api(ctx, '/api/posts', { jar })).res.status, 404);
    assert.equal((await api(ctx, '/api/posts', { jar: nextJar })).res.status, 404);
    const moved = await provePhone(ctx, NEXT, createJar());
    assert.deepEqual(moved.verified.json.messages, APPROVED);
    assert.equal((await api(ctx, `/media/${MEDIA_ID}`, {
      cookie: moved.verified.res.headers.getSetCookie()[0].split(';')[0],
    })).text, 'FICTIONAL_MEDIA_BYTES');
    const old = await provePhone(ctx, ADA, createJar());
    assertWaiting(old.verified.json);
    assert.equal((await api(ctx, '/api/artwork', {
      cookie: old.verified.res.headers.getSetCookie()[0].split(';')[0],
    })).res.status, 404);
    const superseded = await accountByAccess(ctx, 'superseded');
    assert.ok(superseded);
    assert.equal((await ownerPost(ctx, `/api/owner/accounts/${superseded.id}/restore`)).res.status, 409);
  }, {
    clock,
    policy: {
      codeTtlMs: 1_000,
      maxAttempts: 5,
      minResendIntervalMs: 0,
      maxSendsPerWindow: 20,
      resendWindowMs: 120_000,
      attemptWindowMs: 120_000,
      maxIpAttempts: 30,
      sessionAbsoluteTtlMs: 120_000,
      sessionIdleTtlMs: 120_000,
      ownerNonceTtlMs: 120_000,
    },
  });
});

test('owner actions require the owner token, origin, and a one-use csrf token', async () => {
  await withServer(async (ctx) => {
    const jar = createJar();
    const verified = await provePhone(ctx, UNMATCHED, jar);
    const pending = await accountByAccess(ctx, 'pending');
    const friendAttempt = await api(ctx, `/api/owner/accounts/${pending.id}/approve`, {
      method: 'POST',
      jar,
      csrf: verified.verified.json.csrfToken,
      body: {},
    });
    assert.equal(friendAttempt.res.status, 404);
    assert.equal((await api(ctx, '/api/posts', { jar })).res.status, 404);

    const csrf = await ownerCsrf(ctx);
    const evil = await api(ctx, `/api/owner/accounts/${pending.id}/approve`, {
      method: 'POST',
      token: ctx.owner,
      csrf,
      origin: 'https://evil.example',
      body: {},
    });
    assert.equal(evil.res.status, 403);
    const cross = await api(ctx, `/api/owner/accounts/${pending.id}/approve`, {
      method: 'POST',
      token: ctx.owner,
      csrf,
      headers: { 'sec-fetch-site': 'cross-site' },
      body: {},
    });
    assert.equal(cross.res.status, 403);
    const wrongBearer = await api(ctx, `/api/owner/accounts/${pending.id}/approve`, {
      method: 'POST',
      token: 'not-the-owner-token',
      csrf,
      body: {},
    });
    assert.equal(wrongBearer.res.status, 404);
    const approved = await api(ctx, `/api/owner/accounts/${pending.id}/approve`, {
      method: 'POST',
      token: ctx.owner,
      csrf,
      body: {},
    });
    assert.equal(approved.res.status, 200);
    const replay = await api(ctx, `/api/owner/accounts/${pending.id}/revoke`, {
      method: 'POST',
      token: ctx.owner,
      csrf,
      body: {},
    });
    assert.equal(replay.res.status, 403);
    assert.equal((await api(ctx, '/api/posts', { jar })).json.posts[0].text, POST_TEXT);

    const missing = await api(ctx, '/api/access/introduction', {
      method: 'POST',
      jar,
      origin: null,
      csrf: verified.verified.json.csrfToken,
      body: { answer: 'should not save' },
    });
    assert.equal(missing.res.status, 403);
    const badToken = await api(ctx, '/api/access/introduction', {
      method: 'POST',
      jar,
      csrf: 'wrong-csrf-token',
      body: { answer: 'should not save either' },
    });
    assert.equal(badToken.res.status, 403);
    const queue = await api(ctx, '/api/owner/queue', { token: ctx.owner });
    assert.equal(queue.text.includes('should not save'), false);

    const playback = await api(ctx, '/api/playback', { jar });
    assert.equal(playback.res.status, 403);
    assert.equal(playback.text.includes(POST_TEXT), false);
    assert.equal(playback.text.includes('192.168.'), false);
  });
});

test('legacy invite routes cannot spend a code or create a session', async () => {
  await withServer(async (ctx) => {
    await importDirectory(ctx, SAMPLE_VCF);
    const started = await api(ctx, '/api/access/phone/start', {
      method: 'POST',
      body: { phone: ADA },
    });
    assert.deepEqual(started.json, { ok: true });
    const code = ctx.courier.takeCodeForTests(ADA);
    for (const pathname of [`/invite/${code}`, '/%69nvite/abc', '/api/friends/accept', '/join/abc']) {
      const out = await api(ctx, pathname, {
        method: pathname === '/api/friends/accept' ? 'POST' : 'GET',
        body: pathname === '/api/friends/accept' ? { phone: ADA, code } : undefined,
      });
      assert.equal(out.res.status, 404, pathname);
      assert.equal(out.res.headers.getSetCookie().length, 0);
      assertPrivate(out.res);
      assert.equal(out.text.includes(code), false);
    }
    const jar = createJar();
    const verified = await api(ctx, '/api/access/phone/verify', {
      method: 'POST',
      jar,
      body: { phone: ADA, code },
    });
    jar.store(verified.res);
    assert.deepEqual(verified.json.messages, APPROVED);
    const bait = await api(ctx, `/api/posts?invite=${code}`, { headers: CONDITIONAL });
    assert.equal(bait.res.status, 404);
    assert.equal(bait.text.includes(POST_TEXT), false);
    assert.equal((await api(ctx, '/api/posts', { jar })).res.status, 200);
  });
});

test('approved viewers still do not receive playback, and missing assets look denied', async () => {
  await withServer(async (ctx) => {
    await importDirectory(ctx, SAMPLE_VCF);
    const jar = createJar();
    await provePhone(ctx, ADA, jar);
    const played = await api(ctx, `/media/${MEDIA_ID}?action=play`, { jar });
    assert.equal(played.res.status, 403);
    assert.equal(played.text.includes('FICTIONAL_MEDIA_BYTES'), false);
    assert.equal(played.text.includes('http://'), false);
    const viewed = await api(ctx, `/media/${MEDIA_ID}`, { jar, headers: CONDITIONAL });
    assert.equal(viewed.text, 'FICTIONAL_MEDIA_BYTES');
    assert.notEqual(viewed.res.status, 304);
    const missing = await api(ctx, '/media/fx-missing', { jar });
    const anonymous = await api(ctx, `/media/${MEDIA_ID}`);
    assert.equal(missing.res.status, anonymous.res.status);
    assert.equal(missing.text, anonymous.text);
    assert.equal(missing.res.headers.get('content-length'), anonymous.res.headers.get('content-length'));

    const badJson = await api(ctx, '/api/access/phone/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    assert.equal(badJson.res.status, 400);
    assert.deepEqual(badJson.json, { ok: false });
  });
});

test('edge rejects skip self-approval, empty introductions, and merging two friends', async () => {
  const { createReviewServer } = require('../review/harness');
  assert.throws(() => createReviewServer({ runtime: 'production' }), /refuses non-test/);

  await withServer(async (ctx) => {
    const signedOut = await api(ctx, '/api/access/introduction', {
      method: 'POST',
      body: { answer: 'nobody' },
    });
    assert.equal(signedOut.res.status, 401);
    const loggedOut = await api(ctx, '/api/access/logout', { method: 'POST' });
    assert.equal(loggedOut.res.status, 403);
    const ownerMissing = await api(ctx, '/api/owner/csrf');
    assert.equal(ownerMissing.res.status, 404);
    assert.equal(ownerMissing.text.includes('csrfToken'), false);
    const missingAccount = await ownerPost(ctx, '/api/owner/accounts/not-a-real-account/approve');
    assert.equal(missingAccount.res.status, 404);

    await importDirectory(ctx, [
      'BEGIN:VCARD',
      'FN:Ada Example',
      `TEL:${ADA}`,
      'END:VCARD',
      'BEGIN:VCARD',
      'FN:Ben Example',
      'TEL:+15555550102',
      'END:VCARD',
    ].join('\n'));

    const adaJar = createJar();
    const ada = await provePhone(ctx, ADA, adaJar);
    const benJar = createJar();
    const ben = await provePhone(ctx, '+15555550102', benJar);
    assert.deepEqual(ada.verified.json.messages, APPROVED);
    assert.deepEqual(ben.verified.json.messages, APPROVED);

    const empty = await api(ctx, '/api/access/introduction', {
      method: 'POST',
      jar: adaJar,
      csrf: ada.verified.json.csrfToken,
      body: { answer: '   ', evidenceNote: 'x'.repeat(501) },
    });
    assert.equal(empty.res.status, 400);

    const pendingChange = await api(ctx, '/api/access/number-change', {
      method: 'POST',
      jar: createJar(),
      body: { phone: NEXT },
    });
    assert.equal(pendingChange.res.status, 401);

    const same = await api(ctx, '/api/access/number-change', {
      method: 'POST',
      jar: adaJar,
      csrf: ada.verified.json.csrfToken,
      body: { phone: '15555550100' },
    });
    assert.deepEqual(same.json.messages, APPROVED);
    const ambiguous = await api(ctx, '/api/access/number-change', {
      method: 'POST',
      jar: adaJar,
      csrf: ada.verified.json.csrfToken,
      body: { phone: ADA },
    });
    assert.equal(ambiguous.res.status, 200);
    let queue = await api(ctx, '/api/owner/queue', { token: ctx.owner });
    assert.equal(queue.json.numberChanges.length, 0);

    const move = await api(ctx, '/api/access/number-change', {
      method: 'POST',
      jar: adaJar,
      csrf: ada.verified.json.csrfToken,
      body: { phone: '+15555550102' },
    });
    assert.equal(move.res.status, 200);
    queue = await api(ctx, '/api/owner/queue', { token: ctx.owner });
    const adaAccount = queue.json.accounts.find((account) => account.id !== ben.verified.json.csrfToken && account.access === 'approved');
    const change = queue.json.numberChanges[0];
    assert.equal(change.proofVerified, false);

    const badProof = await api(ctx, '/api/access/number-change/prove', {
      method: 'POST',
      origin: 'https://evil.example',
      body: { phone: '+15555550102', code: '000000' },
    });
    assert.equal(badProof.res.status, 403);
    const wrongProof = await api(ctx, '/api/access/number-change/prove', {
      method: 'POST',
      body: { phone: '+15555550102', code: '000000' },
    });
    assert.equal(wrongProof.res.status, 401);
    const notE164 = await api(ctx, '/api/access/number-change/prove', {
      method: 'POST',
      body: { phone: '5550102', code: '000000' },
    });
    assert.equal(notE164.res.status, 401);

    await api(ctx, '/api/access/phone/start', {
      method: 'POST',
      body: { phone: '+15555550102' },
    });
    const proof = ctx.courier.takeCodeForTests('+15555550102');
    const proved = await api(ctx, '/api/access/number-change/prove', {
      method: 'POST',
      body: { phone: '+15555550102', code: proof },
    });
    assert.deepEqual(proved.json, { ok: true });
    const blocked = await ownerPost(ctx, `/api/owner/number-changes/${change.id}/approve`);
    assert.equal(blocked.res.status, 409);
    assert.equal((await api(ctx, '/api/posts', { jar: adaJar })).res.status, 200);
    assert.equal((await api(ctx, '/api/posts', { jar: benJar })).res.status, 200);
    assert.equal(JSON.stringify(adaAccount || {}).includes('+15555550102'), false);

    const badChange = await api(ctx, '/api/access/number-change', {
      method: 'POST',
      jar: adaJar,
      csrf: 'wrong-csrf-token',
      body: { phone: '+15555550177' },
    });
    assert.equal(badChange.res.status, 403);
    const deniedImport = await api(ctx, '/api/owner/contacts/import', {
      method: 'POST',
      token: ctx.owner,
      body: 'BEGIN:VCARD\nEND:VCARD',
    });
    assert.equal(deniedImport.res.status, 403);

    const fresh = '+15555550177';
    const requested = await api(ctx, '/api/access/number-change', {
      method: 'POST',
      jar: adaJar,
      csrf: ada.verified.json.csrfToken,
      body: { phone: fresh },
    });
    assert.equal(requested.res.status, 200);
    queue = await api(ctx, '/api/owner/queue', { token: ctx.owner });
    const freshChange = queue.json.numberChanges.find((item) => item.id !== change.id && !item.proofVerified);
    const noOwner = await api(ctx, `/api/owner/number-changes/${freshChange.id}/approve`, {
      method: 'POST',
      body: {},
    });
    assert.equal(noOwner.res.status, 404);
    await api(ctx, '/api/access/phone/start', { method: 'POST', body: { phone: fresh } });
    const freshCode = ctx.courier.takeCodeForTests(fresh);
    const freshProof = await api(ctx, '/api/access/number-change/prove', {
      method: 'POST',
      body: { phone: fresh, code: freshCode },
    });
    assert.deepEqual(freshProof.json, { ok: true });
    const moved = await ownerPost(ctx, `/api/owner/number-changes/${freshChange.id}/approve`);
    assert.equal(moved.res.status, 200);
    assert.equal((await api(ctx, '/api/posts', { jar: adaJar })).res.status, 404);
    const relocated = await provePhone(ctx, fresh, createJar());
    assert.deepEqual(relocated.verified.json.messages, APPROVED);
    assert.equal((await api(ctx, '/api/posts', { jar: benJar })).res.status, 200);
  });
});

test('unexpected media failure stays generic', async () => {
  const item = { type: 'application/octet-stream' };
  Object.defineProperty(item, 'body', {
    get() { throw new Error('boom'); },
  });
  await withServer(async (ctx) => {
    await importDirectory(ctx, SAMPLE_VCF);
    const jar = createJar();
    await provePhone(ctx, ADA, jar);
    const out = await api(ctx, `/media/${MEDIA_ID}`, { jar });
    assert.equal(out.res.status, 500);
    assert.deepEqual(out.json, { ok: false });
    assert.equal(out.text.includes('boom'), false);
    assertPrivate(out.res);
  }, { media: new Map([[MEDIA_ID, item]]) });
});

test('a missing public directory fails closed', async () => {
  await withServer(async (ctx) => {
    const page = await api(ctx, '/');
    assert.equal(page.res.status, 404);
    assert.equal(page.text, 'Not found\n');
    assertPrivate(page.res);
  }, { publicDir: fs.mkdtempSync(path.join(os.tmpdir(), 'markvee-empty-')), posts: [], media: new Map() });
});
