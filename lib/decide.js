'use strict';

const { COPY } = require('./copy');

const BLOCKED = new Set(['denied', 'revoked', 'superseded']);

/**
 * Phone possession is required before this runs.
 * A directory hit never restores denied, revoked, or superseded accounts.
 */
function decideAccess({ priorStatus, phoneMatched }) {
  const prior = priorStatus || 'none';
  if (BLOCKED.has(prior)) {
    return { access: prior, friendApproved: false };
  }
  if (prior === 'approved') {
    return { access: 'approved', friendApproved: true };
  }
  if (phoneMatched) {
    return { access: 'approved', friendApproved: true };
  }
  return { access: 'pending', friendApproved: false };
}

function applicantMessages(account) {
  if (!account || !account.phoneVerifiedAt) return [];
  if (account.access === 'approved') {
    return [COPY.phoneVerified, COPY.friendApproved];
  }
  return [COPY.phoneVerified, COPY.unmatchedQuestion, COPY.pendingReview];
}

module.exports = { decideAccess, applicantMessages, BLOCKED };
