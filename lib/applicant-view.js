'use strict';

const { COPY } = require('./copy');

const ALLOWED = new Set(Object.values(COPY));

/** Keep future UI on the approved strings and nothing else. */
function applicantView(messages) {
  const text = (Array.isArray(messages) ? messages : []).filter((item) => ALLOWED.has(item));
  return {
    text,
    showPhoneVerified: text.includes(COPY.phoneVerified),
    showQuestion: text.includes(COPY.unmatchedQuestion),
    showPending: text.includes(COPY.pendingReview),
    showApproved: text.includes(COPY.friendApproved),
  };
}

module.exports = { applicantView };
