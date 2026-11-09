'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const PASTED = {
  'server.js': 'e82a75d880c72b27bbb8a352c9a2f0790228ca385e4689319bc9a9ef6b4222ac',
  'chronicle-proxy.js': 'e6aaaf6d9554aee85919a91a6b7e89d764e19cd3491b8e678a41a3673cb00962',
  'immich-admin.js': 'ad372b9d9c1de9f489acd63dc69703123ea9b9e8d8f6a14cb6a8e9329914eb65',
  'friends.js': 'c5d44e12bf90f83f7a1410293fa5e76b6d1b40da71ab0e8487fe0215d2731f68',
};

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
}

test('repo server.js does not match the pasted portal hash', () => {
  const actual = sha256('server.js');
  assert.equal(actual, '961b4a739fb11f799169aaa208d36ae549cd73bc3e0ad1d3733350ee8b1b6e56');
  assert.notEqual(actual, PASTED['server.js']);
});

test('pasted portal modules are not in this repo', () => {
  for (const file of ['chronicle-proxy.js', 'immich-admin.js', 'friends.js']) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), false);
    assert.equal(fs.existsSync(path.join(ROOT, 'lib', file)), false);
    assert.equal(fs.existsSync(path.join(ROOT, 'public', file)), false);
  }
});

test('the live entrypoint is not wired to the review modules', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const docker = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.doesNotMatch(server, /createAccessHandler|review\/harness|lib\/access/);
  assert.doesNotMatch(docker, /review\/harness/);
  assert.doesNotMatch(compose, /review\/harness/);
  assert.equal(pkg.scripts.start, 'node server.js');
  const handler = fs.readFileSync(path.join(ROOT, 'lib', 'access-handler.js'), 'utf8');
  assert.doesNotMatch(handler, /takeCodeForTests|console\.|writeFile|graph\.facebook|192\.168\./);
});

test('review harness exits instead of listening', () => {
  const result = spawnSync(process.execPath, ['review/harness.js'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /not a production server/);
});

test('source scan reports no high-confidence secrets', () => {
  const rules = [
    ['private_key', /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/],
    ['aws_access_key', /AKIA[0-9A-Z]{16}/],
    ['slack_token', /xox[baprs]-[0-9A-Za-z-]{10,}/],
    ['github_pat', /ghp_[0-9A-Za-z]{20,}/],
    ['stripe_live', /sk_live_[0-9A-Za-z]+/],
  ];
  const hits = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'coverage') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const bytes = fs.readFileSync(full);
      if (bytes.includes(0)) continue;
      const lines = bytes.toString('utf8').split('\n');
      lines.forEach((line, index) => {
        for (const [name, rule] of rules) {
          if (rule.test(line)) hits.push(`${path.relative(ROOT, full)}:${index + 1}:${name}`);
        }
      });
    }
  }
  walk(ROOT);
  assert.deepEqual(hits, []);
});

test('isolated modules do not name lan media endpoints', () => {
  const rules = [
    /192\.168\.\d+\.\d+/,
    /(?:^|[^0-9])10\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
    /172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+/,
    /graph\.facebook/i,
    /localhost/i,
    /console\./,
  ];
  for (const dir of ['lib', 'review']) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      const text = fs.readFileSync(path.join(ROOT, dir, name), 'utf8');
      for (const rule of rules) assert.doesNotMatch(text, rule, `${dir}/${name}`);
    }
  }
});
