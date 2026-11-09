'use strict';

/**
 * PROVISIONAL ACCESS POLICY — NOT OWNER-APPROVED.
 *
 * Session duration, code lifetime, resend limits, and account recovery were
 * left as open decisions. These values fail safe so the private build can be
 * reviewed. They are configuration, not a decision Mark has accepted.
 *
 * Number changes never complete from possession proof alone. Owner review and
 * a new possession proof are both required. There is no automatic recovery.
 */
const PROVISIONAL_POLICY = Object.freeze({
  codeTtlMs: 10 * 60 * 1000,
  maxAttempts: 5,
  minResendIntervalMs: 60 * 1000,
  maxSendsPerWindow: 3,
  resendWindowMs: 15 * 60 * 1000,
  attemptWindowMs: 15 * 60 * 1000,
  maxIpAttempts: 30,
  sessionAbsoluteTtlMs: 8 * 60 * 60 * 1000,
  sessionIdleTtlMs: 60 * 60 * 1000,
  ownerNonceTtlMs: 10 * 60 * 1000,
});

/**
 * Facts that block merge, deploy, and any claim of a finished rollout.
 * Integration into the deployed portal is not done.
 */
const RELEASE_BLOCKS = Object.freeze([
  'Review branch only. Do not merge and do not deploy.',
  'Repo server.js hash does not match the host/container markvee-portal server.js hash. chronicle-proxy.js, immich-admin.js, and friends.js are not in this repo. Runtime integration is blocked.',
  'Do not replace the production Cloudflare Worker markvee-site, DNS, hosting, or the mvforge service.',
  'No SMS provider or budget is selected. Production delivery fails closed. The fake transport is test-only.',
  'A real contact file must not be copied into this workspace, git, logs, or reports. Tests stay on synthetic fixtures.',
  'Session duration and number-change recovery defaults are provisional and are not owner-approved policy.',
  'Durable state is a local SQLite file. There is no hosted database. The in-memory store is a test double only.',
  'The device controller is a separate internal app and is not part of markvee.org.',
  'Screens are being designed separately. This branch does not redesign the homepage or wire a new interface into the served page.',
  'Current server.js still serves posts and media without this gate. That file was left unchanged on purpose.',
  'Tests use fictional contacts and an in-memory courier. They are not browser, shared-cache, SMS, or production verification.',
  'Playback, LAN proxying, live contact import, and external messages are not included.',
]);

function resolvePolicy(overrides, runtime) {
  const policy = { ...PROVISIONAL_POLICY, ...(overrides || {}) };
  if (runtime === 'test') return policy;
  return {
    ...policy,
    codeTtlMs: Math.min(policy.codeTtlMs, PROVISIONAL_POLICY.codeTtlMs),
    maxAttempts: Math.min(policy.maxAttempts, PROVISIONAL_POLICY.maxAttempts),
    minResendIntervalMs: Math.max(policy.minResendIntervalMs, PROVISIONAL_POLICY.minResendIntervalMs),
    maxSendsPerWindow: Math.min(policy.maxSendsPerWindow, PROVISIONAL_POLICY.maxSendsPerWindow),
    resendWindowMs: Math.max(policy.resendWindowMs, PROVISIONAL_POLICY.resendWindowMs),
    attemptWindowMs: Math.max(policy.attemptWindowMs, PROVISIONAL_POLICY.attemptWindowMs),
    maxIpAttempts: Math.min(policy.maxIpAttempts, PROVISIONAL_POLICY.maxIpAttempts),
    sessionAbsoluteTtlMs: Math.min(policy.sessionAbsoluteTtlMs, PROVISIONAL_POLICY.sessionAbsoluteTtlMs),
    sessionIdleTtlMs: Math.min(policy.sessionIdleTtlMs, PROVISIONAL_POLICY.sessionIdleTtlMs),
    ownerNonceTtlMs: Math.min(policy.ownerNonceTtlMs, PROVISIONAL_POLICY.ownerNonceTtlMs),
  };
}

module.exports = { PROVISIONAL_POLICY, RELEASE_BLOCKS, resolvePolicy };
