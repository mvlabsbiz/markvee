'use strict';

/** Applicant-facing copy. Exact strings supplied for the private build. */
const A = '\u2019';

const COPY = Object.freeze({
  phoneVerified: 'Phone number verified.',
  unmatchedQuestion: `What${A}s your name, and how do we know each other?`,
  pendingReview: `Your request is waiting for Mark${A}s review. Media activity stays private until you${A}re approved.`,
  friendApproved: 'Friend access approved.',
});

module.exports = { COPY };
