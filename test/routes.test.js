'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SITE_ROUTES, classifyRequest } = require('../lib/site-routes');
const { INTEGRATION_MANIFEST } = require('../lib/integration-manifest');
const { withServer, api, importDirectory, provePhone, createJar, SAMPLE_VCF, ADA } = require('../test-helpers/support');

const ROOT = path.join(__dirname, '..');

test('public audience is only the landing shell', () => {
  const publics = SITE_ROUTES.filter((route) => route.audience === 'public').map((route) => route.path);
  assert.deepEqual(publics, ['/', '/style.css', '/script.js']);
  const page = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.equal(page.includes('Founder & Principal Engineer'), true);
  assert.equal(classifyRequest('GET', '/').audience, 'public');
  assert.equal(classifyRequest('GET', '/api/posts').audience, 'approved-friend');
  assert.equal(classifyRequest('POST', '/api/posts').audience, 'owner');
  assert.equal(classifyRequest('POST', '/api/profile').audience, 'owner');
  assert.equal(classifyRequest('POST', '/api/banner').audience, 'owner');
  assert.equal(classifyRequest('GET', '/devices').audience, 'out-of-scope');
  assert.equal(classifyRequest('POST', '/controller').audience, 'out-of-scope');
});

test('wireframed personal regions are friend-only and present in the drawing', () => {
  const drawing = fs.readFileSync(path.join(ROOT, 'markvee.org.excalidraw'), 'utf8');
  const regions = SITE_ROUTES.filter((route) => route.wireframe);
  assert.ok(regions.length >= 12);
  for (const route of regions) {
    assert.equal(route.audience, 'approved-friend', route.id);
    assert.equal(drawing.includes(route.wireframe), true, route.id);
  }
});

test('existing server routes are classified and the entry file is preserved', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  for (const token of ['/', '/style.css', '/script.js', '/profile', '/banner', '/api/posts', '/api/profile', '/api/banner', '/media/']) {
    assert.equal(server.includes(token), true, token);
  }
  assert.doesNotMatch(server, /durable-store|site-routes|createAccessHandler/);
  for (const file of INTEGRATION_MANIFEST.preserve) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), true, file);
  }
  for (const file of INTEGRATION_MANIFEST.mount) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), true, file);
  }
  assert.deepEqual(INTEGRATION_MANIFEST.doNotBuild, ['device controller']);
  assert.equal(INTEGRATION_MANIFEST.storage.memoryStore, 'test double only');
});

test('unimplemented personal and device paths are not public pages', async () => {
  await withServer(async (ctx) => {
    await importDirectory(ctx, SAMPLE_VCF);
    const jar = createJar();
    await provePhone(ctx, ADA, jar);
    for (const pathname of ['/work', '/education', '/travel', '/streaming/music', '/photos/landscape', '/hobbies', '/posts', '/devices', '/controller']) {
      const signedOut = await api(ctx, pathname);
      const approved = await api(ctx, pathname, { jar });
      assert.equal(signedOut.res.status, 404, pathname);
      assert.equal(approved.res.status, 404, pathname);
      assert.equal(signedOut.text, 'Not found\n');
      assert.equal(approved.text, 'Not found\n');
      assert.equal(approved.text.includes('Founder'), false);
    }
    const create = await api(ctx, '/api/posts', {
      method: 'POST',
      token: ctx.owner,
      body: { text: 'FICTIONAL_SHOULD_NOT_APPEAR' },
    });
    assert.equal(create.res.status, 404);
    assert.equal(create.text.includes('FICTIONAL_SHOULD_NOT_APPEAR'), false);
    const posts = await api(ctx, '/api/posts', { jar });
    assert.equal(posts.res.status, 200);
    assert.equal(posts.json.posts[0].text, 'FICTIONAL_PRIVATE_POST');
  });
});
