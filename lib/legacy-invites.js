'use strict';

/**
 * Defensive legacy paths. This is not an inventory of the deployed portal:
 * those route files are not in the repo. Every path here is denied and cannot
 * create a session, consume a code, or approve anyone.
 */
const LEGACY_PATTERNS = Object.freeze([
  /^\/invite(?:\/|$)/i,
  /^\/api\/invite(?:\/|$)/i,
  /^\/api\/invites(?:\/|$)/i,
  /^\/join(?:\/|$)/i,
  /^\/api\/join(?:\/|$)/i,
  /^\/api\/friends\/invite(?:\/|$)/i,
  /^\/api\/friends\/accept(?:\/|$)/i,
  /^\/friend-invite(?:\/|$)/i,
  /^\/r\/[^/]+$/i,
  /^\/i\/[^/]+$/i,
]);

function isLegacyInvitePath(pathname) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }
  return LEGACY_PATTERNS.some((pattern) => pattern.test(pathname) || pattern.test(decoded));
}

module.exports = { LEGACY_PATTERNS, isLegacyInvitePath };
