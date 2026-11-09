'use strict';

const { randomCode, phoneKey, codeHash, safeEqual } = require('./crypto-util');

function createChallengeService({ store, courier, policy, pepper, now }) {
  function rateBucket(key) {
    const bucket = store.rate.get(key) || { sends: [], attempts: [] };
    store.rate.set(key, bucket);
    return bucket;
  }

  function prune(list, windowMs, t) {
    return list.filter((ts) => t - ts < windowMs);
  }

  async function start({ e164, ip }) {
    const t = now();
    const key = phoneKey(pepper, e164);
    const ipKey = phoneKey(pepper, `ip:${ip || 'unknown'}`);
    const phoneRate = rateBucket(key);
    const ipRate = rateBucket(ipKey);
    phoneRate.sends = prune(phoneRate.sends, policy.resendWindowMs, t);
    ipRate.sends = prune(ipRate.sends, policy.resendWindowMs, t);
    const last = phoneRate.sends.length ? phoneRate.sends[phoneRate.sends.length - 1] : null;
    const intervalOk = last == null || (t - last) >= policy.minResendIntervalMs;
    const underCap = phoneRate.sends.length < policy.maxSendsPerWindow
      && ipRate.sends.length < policy.maxSendsPerWindow;

    if (intervalOk && underCap) {
      const code = randomCode();
      const result = await courier.send({ e164, code });
      if (result && result.delivered) {
        store.challenges.set(key, {
          codeHash: codeHash(pepper, key, code),
          expiresAt: t + policy.codeTtlMs,
          attempts: 0,
        });
        phoneRate.sends.push(t);
        ipRate.sends.push(t);
      }
    }
    return { ok: true };
  }

  function verify({ e164, code, ip }) {
    const t = now();
    const key = phoneKey(pepper, e164);
    const ipKey = phoneKey(pepper, `ip:${ip || 'unknown'}`);
    const ipRate = rateBucket(ipKey);
    ipRate.attempts = prune(ipRate.attempts, policy.attemptWindowMs, t);
    const presented = String(code == null ? '' : code).trim();
    const actual = codeHash(pepper, key, presented);
    const dummy = codeHash(pepper, key, '000000');

    if (ipRate.attempts.length >= policy.maxIpAttempts) {
      safeEqual(dummy, actual);
      ipRate.attempts.push(t);
      return { ok: false };
    }

    const challenge = store.challenges.get(key);
    if (!challenge || challenge.expiresAt <= t) {
      if (challenge && challenge.expiresAt <= t) store.challenges.delete(key);
      safeEqual(dummy, actual);
      ipRate.attempts.push(t);
      return { ok: false };
    }

    challenge.attempts += 1;
    const match = safeEqual(challenge.codeHash, actual) && /^\d{6}$/.test(presented);
    if (!match || challenge.attempts > policy.maxAttempts) {
      if (challenge.attempts >= policy.maxAttempts) store.challenges.delete(key);
      ipRate.attempts.push(t);
      return { ok: false };
    }

    store.challenges.delete(key);
    return { ok: true, phoneHmac: key };
  }

  return { start, verify };
}

module.exports = { createChallengeService };
