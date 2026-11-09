'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone, sameE164 } = require('../lib/phone');

const expected = [
  ['+1 (555) 555-0100', 'e164', '+15555550100'],
  ['+1.555.555.0100', 'e164', '+15555550100'],
  ['tel:+1-555-555-0100', 'e164', '+15555550100'],
  ['tel:+1%20555%20555%200100', 'e164', '+15555550100'],
  ['tel:+1-555-555-0100;ext=9', 'e164', '+15555550100'],
  ['+1 555 555 0100 ext. 9', 'e164', '+15555550100'],
  ['+1 555 555 0100 extension 9', 'e164', '+15555550100'],
  ['+1 555 555 0100 x9', 'e164', '+15555550100'],
  ['0015555550100', 'e164', '+15555550100'],
  ['00 1 555 555 0100', 'e164', '+15555550100'],
  ['01115555550100', 'e164', '+15555550100'],
  ['011 1 555 555 0100', 'e164', '+15555550100'],
  ['+12345678', 'e164', '+12345678'],
  ['5555550100', 'ambiguous'],
  ['555-555-0100', 'ambiguous'],
  ['(555) 555-0100', 'ambiguous'],
  ['15555550100', 'ambiguous'],
  ['1-555-555-0100', 'ambiguous'],
  ['5555550100 x9', 'ambiguous'],
  ['+0123456789', 'invalid'],
  ['+1234567', 'invalid'],
  ['+1234567890123456', 'invalid'],
  ['++15555550100', 'invalid'],
  ['1+5555550100', 'invalid'],
  ['+1-555-FLOWERS', 'invalid'],
  ['+15555550100x12', 'invalid'],
  ['', 'invalid'],
  ['   ', 'invalid'],
  ['tel:', 'invalid'],
  ['\uFF0B15555550100', 'invalid'],
  ['+\uFF115555550100', 'invalid'],
];

test('normalizes fictional numbers without guessing a country', () => {
  for (const [input, status, e164] of expected) {
    const result = normalizePhone(input);
    assert.equal(result.status, status, input);
    assert.equal(result.e164, e164);
  }
  for (const input of [null, undefined, 15555550100, { phone: '+15555550100' }, ['+15555550100']]) {
    assert.equal(normalizePhone(input).status, 'invalid');
  }
});

test('ambiguous numbers do not compare equal to an explicit contact', () => {
  assert.equal(sameE164('+1 (555) 555-0100', '00 1 555 555 0100'), true);
  assert.equal(sameE164('+15555550100 ext. 4', '+15555550100'), true);
  assert.equal(sameE164('15555550100', '+15555550100'), false);
  assert.equal(sameE164('5555550100', '+15555550100'), false);
  assert.equal(sameE164('(555) 555-0100', '555-555-0100'), false);
  assert.equal(sameE164('+15555550100', '+15555550101'), false);
  assert.equal(sameE164('', ''), false);
});
