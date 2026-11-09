'use strict';

const crypto = require('crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function hmacHex(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest('hex');
}

function randomId(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function randomCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(sha256(left), sha256(right));
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function phoneKey(pepper, e164) {
  return hmacHex(pepper, `phone:${e164}`);
}

function codeHash(pepper, phoneKeyHex, code) {
  return hmacHex(pepper, `code:${phoneKeyHex}:${code}`);
}

function assertSecret(name, value) {
  if (typeof value !== 'string' || value.length < 16) {
    throw new Error(`missing ${name}`);
  }
}

module.exports = {
  sha256,
  hmacHex,
  randomId,
  randomCode,
  safeEqual,
  phoneKey,
  codeHash,
  assertSecret,
};
