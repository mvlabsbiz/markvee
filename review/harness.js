'use strict';

/**
 * Test-only wiring for the isolated access modules.
 * This is not markvee-portal server.js, not the Cloudflare Worker markvee-site,
 * and not a deployment entry. package.json start remains node server.js.
 * Running this file directly exits without listening.
 */

const http = require('http');
const { createAccessHandler } = require('../lib/access-handler');
const { createMemoryStore } = require('../lib/store');

function createReviewServer(opts = {}) {
  if (opts.runtime && opts.runtime !== 'test') {
    throw new Error('review harness refuses non-test runtime');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('review harness refuses production');
  }
  const store = opts.store || createMemoryStore();
  let handler = null;
  const server = http.createServer((req, res) => {
    if (!handler) {
      res.writeHead(503);
      res.end();
      return;
    }
    handler(req, res);
  });

  return {
    server,
    store,
    listen() {
      return new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
          try {
            const { port } = server.address();
            const origin = `http://127.0.0.1:${port}`;
            handler = createAccessHandler({
              runtime: 'test',
              delivery: 'fake',
              allowTestDelivery: true,
              store,
              siteOrigin: origin,
              pepper: opts.pepper || 'test-pepper-not-for-production',
              sessionSecret: opts.sessionSecret || 'test-session-secret-value',
              ownerToken: opts.ownerToken || 'test-owner-token-value',
              now: opts.now || (() => Date.now()),
              policy: opts.policy,
              media: opts.media,
              posts: opts.posts,
              publicDir: opts.publicDir,
            });
            resolve({
              port,
              origin,
              handler,
              courier: handler.courier,
              store,
            });
          } catch (err) {
            reject(err);
          }
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

if (require.main === module) {
  process.stderr.write('review harness is not a production server\n');
  process.exit(1);
}

module.exports = { createReviewServer };
