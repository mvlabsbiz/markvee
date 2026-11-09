'use strict';

const PRIVATE_NO_STORE = Object.freeze({
  'Cache-Control': 'private, no-store',
  Pragma: 'no-cache',
  'CDN-Cache-Control': 'no-store',
  'Surrogate-Control': 'no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
});

function canViewProtected(account) {
  return Boolean(
    account
    && account.phoneVerifiedAt
    && account.access === 'approved',
  );
}

/** Viewing is a separate decision. Playback is not authorized. */
function playbackAllowed() {
  return false;
}

function isPlaybackRequest(urlObj) {
  if (/(^|\/)(playback|play)(\/|$)/i.test(urlObj.pathname)) return true;
  for (const [key, value] of urlObj.searchParams.entries()) {
    if (/^(playback|play|autoplay)$/i.test(key)) return true;
    if (key.toLowerCase() === 'action' && /^play(?:back)?$/i.test(value)) return true;
  }
  return false;
}

module.exports = {
  PRIVATE_NO_STORE,
  canViewProtected,
  playbackAllowed,
  isPlaybackRequest,
};
