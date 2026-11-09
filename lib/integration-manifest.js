'use strict';

const { SITE_ROUTES } = require('./site-routes');

/**
 * Files an integrator needs. This does not mount them into server.js.
 * The production entry stays server.js. The device controller is not in this list.
 */
const INTEGRATION_MANIFEST = Object.freeze({
  preserve: Object.freeze([
    'server.js',
    'public/index.html',
    'public/script.js',
    'public/style.css',
    'package.json',
    'Dockerfile',
    'docker-compose.yml',
  ]),
  mount: Object.freeze([
    'lib/access-handler.js',
    'lib/applicant-view.js',
    'lib/challenges.js',
    'lib/copy.js',
    'lib/crypto-util.js',
    'lib/decide.js',
    'lib/delivery.js',
    'lib/directory.js',
    'lib/durable-store.js',
    'lib/gate.js',
    'lib/index.js',
    'lib/integration-manifest.js',
    'lib/legacy-invites.js',
    'lib/phone.js',
    'lib/policy.js',
    'lib/sessions.js',
    'lib/site-routes.js',
    'lib/store.js',
    'lib/vcf.js',
  ]),
  doNotStart: Object.freeze([
    'review/harness.js',
  ]),
  doNotBuild: Object.freeze([
    'device controller',
  ]),
  storage: Object.freeze({
    engine: 'node:sqlite DatabaseSync',
    fileMode: '0600',
    directoryMode: '0700',
    memoryStore: 'test double only',
  }),
  routes: SITE_ROUTES,
});

module.exports = { INTEGRATION_MANIFEST };
