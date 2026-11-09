'use strict';

const { randomCode, phoneKey, codeHash, safeEqual } = require('./crypto-util');

function createChallengeService({ store, courier, policy, pepper, now }) {
  function loadRate(key) {
    return store.rate.get(key) || { sends: [], attempts: [] };
  }

  function saveRate(key, bucket) {
    store.rate.set(key, {
      sends: bucket.sends.slice(),
      attempts: bucket.attempts.slice(),
    });
  }

  function prune(list, windowMs, t) {
    return list.filter((ts) => t - ts < windowMs);
  }

  function inTransaction(fn) {
    if (typeof store.transaction === 'function') return store.transaction(fn);
    return fn();
  }

  async function start({ e164, ip }) {
    const t = now();
    const key = phoneKey(pepper, e164);
    const ipKey = phoneKey(pepper, `ip:${ip || 'unknown'}`);
    const code = randomCode();
    const issued = inTransaction(() => {
      const phoneRate = loadRate(key);
      const ipRate = loadRate(ipKey);
      phoneRate.sends = prune(phoneRate.sends, policy.resendWindowMs, t);
      ipRate.sends = prune(ipRate.sends, policy.resendWindowMs, t);
      const last = phoneRate.sends.length ? phoneRate.sends[phoneRate.sends.length - 1] : null;
      const intervalOk = last == null || (t - last) >= policy.minResendIntervalMs;
      const underCap = phoneRate.sends.length < policy.maxSendsPerWindow
        && ipRate.sends.length < policy.maxSendsPerWindow;
      if (!intervalOk || !underCap) {
        saveRate(key, phoneRate);
        saveRate(ipKey, ipRate);
        return false;
      }
      phoneRate.sends.push(t);
      ipRate.sends.push(t);
      saveRate(key, phoneRate);
      saveRate(ipKey, ipRate);
      store.challenges.set(key, {
        codeHash: codeHash(pepper, key, code),
        expiresAt: t + policy.codeTtlMs,
        attempts: 0,
      });
      return true;
    });
    if (!issued) return { ok: true };

    let delivered = false;
    try {
      const result = await courier.send({ e164, code });
      delivered = Boolean(result && result.delivered);
    } catch {
      delivered = false;
    }
    if (!delivered) {
      inTransaction(() => {
        store.challenges.delete(key);
        const phoneRate = loadRate(key);
        const ipRate = loadRate(ipKey);
        const phoneAt = phoneRate.sends.lastIndexOf(t);
        const ipAt = ipRate.sends.lastIndexOf(t);
        if (phoneAt !== -1) phoneRate.sends.splice(phoneAt, 1);
        if (ipAt !== -1) ipRate.sends.splice(ipAt, 1);
        saveRate(key, phoneRate);
        saveRate(ipKey, ipRate);
      });
    }
    return { ok: true };
  }

  function verify({ e164, code, ip }) {
    return inTransaction(() => {
      const t = now();
      const key = phoneKey(pepper, e164);
      const ipKey = phoneKey(pepper, `ip:${ip || 'unknown'}`);
      const ipRate = loadRate(ipKey);
      ipRate.attempts = prune(ipRate.attempts, policy.attemptWindowMs, t);
      const presented = String(code == null ? '' : code).trim();
      const actual = codeHash(pepper, key, presented);
      const dummy = codeHash(pepper, key, '000000');

      if (typeof store.codeWasConsumed === 'function' && store.codeWasConsumed(key, actual)) {
        safeEqual(dummy, actual);
        ipRate.attempts.push(t);
        saveRate(ipKey, ipRate);
        return { ok: false };
      }

      if (ipRate.attempts.length >= policy.maxIpAttempts) {
        safeEqual(dummy, actual);
        ipRate.attempts.push(t);
        saveRate(ipKey, ipRate);
        return { ok: false };
      }

      const challenge = store.challenges.get(key);
      if (!challenge || challenge.expiresAt <= t) {
        if (challenge && challenge.expiresAt <= t) store.challenges.delete(key);
        safeEqual(dummy, actual);
        ipRate.attempts.push(t);
        saveRate(ipKey, ipRate);
        return { ok: false };
      }

      challenge.attempts += 1;
      const match = safeEqual(challenge.codeHash, actual) && /^\d{6}$/.test(presented);
      if (!match || challenge.attempts > policy.maxAttempts) {
        if (challenge.attempts >= policy.maxAttempts) store.challenges.delete(key);
        ipRate.attempts.push(t);
        saveRate(ipKey, ipRate);
        return { ok: false };
      }

      if (typeof store.markCodeConsumed === 'function') {
        store.markCodeConsumed(key, challenge.codeHash, t);
      }
      store.challenges.delete(key);
      saveRate(ipKey, ipRate);
      return { ok: true, phoneHmac: key };
    });
  }

  return { start, verify };
}

module.exports = { createChallengeService };
