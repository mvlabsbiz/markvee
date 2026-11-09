'use strict';

const { COPY } = require('./copy');
const { PROVISIONAL_POLICY, RELEASE_BLOCKS, resolvePolicy } = require('./policy');
const { normalizePhone, sameE164 } = require('./phone');
const { parseVcf } = require('./vcf');
const { decideAccess, applicantMessages } = require('./decide');
const { createCourier } = require('./delivery');
const { createMemoryStore } = require('./store');
const { applicantView } = require('./applicant-view');
const { isLegacyInvitePath } = require('./legacy-invites');
const { canViewProtected, playbackAllowed } = require('./gate');
const { createAccessHandler } = require('./access-handler');

module.exports = {
  COPY,
  PROVISIONAL_POLICY,
  RELEASE_BLOCKS,
  resolvePolicy,
  normalizePhone,
  sameE164,
  parseVcf,
  decideAccess,
  applicantMessages,
  applicantView,
  createCourier,
  createMemoryStore,
  isLegacyInvitePath,
  canViewProtected,
  playbackAllowed,
  createAccessHandler,
};
