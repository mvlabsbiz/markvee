'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVcf } = require('../lib/vcf');

test('parses folded, encoded, and uri telephone values', () => {
  const vcf = [
    'begin:vcard',
    'VERSION:3.0',
    'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Ada Ex=61mple',
    'TEL;TYPE=CELL:+1555',
    ' 5550100',
    'ITEM1.TEL;TYPE="CELL,VOICE":+15555550100',
    'TEL;VALUE=uri:tel:+1-555-555-0102',
    'TEL;TYPE=HOME:555-0100',
    'TEL;ENCODING=BASE64:MTU1NTU1NTAxMDA=',
    'TEL:',
    'NOTE:mention +19995550123 but do not import it',
    'PHOTO;ENCODING=BASE64:UEhPVE8tU0VDUkVU',
    'end:vcard',
    'BEGIN:VCARD',
    'N:Example;Ben;Q;Dr;Jr',
    'TEL;CELL:+44 20 7946 0991',
    'END:VCARD',
  ].join('\r\n');

  const parsed = parseVcf(vcf);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.contacts.length, 2);
  assert.equal(parsed.contacts[0].displayName, 'Ada Example');
  assert.deepEqual(parsed.contacts[0].phones, ['+15555550100', '+15555550102']);
  assert.equal(parsed.skippedAmbiguous, 1);
  assert.equal(parsed.skippedInvalid, 2);
  assert.equal(parsed.contacts[1].displayName, 'Dr Ben Q Example Jr');
  assert.deepEqual(parsed.contacts[1].phones, ['+442079460991']);
  const dumped = JSON.stringify(parsed);
  assert.equal(dumped.includes('PHOTO-SECRET'), false);
  assert.equal(dumped.includes('UEhPVE8tU0VDUkVU'), false);
  assert.equal(dumped.includes('19995550123'), false);
  assert.equal(dumped.includes('555-0100'), false);
});

test('keeps escaped names and ignores cards without an end or a usable number', () => {
  const parsed = parseVcf([
    'BEGIN:VCARD',
    'FN:Ada\\, Example',
    'TEL;TYPE=HOME:5555550199',
    'END:VCARD',
    'BEGIN:VCARD',
    'NOTE:only a note +15555550100',
    'END:VCARD',
    'BEGIN:VCARD',
    'FN:No End',
    'TEL:+15555550177',
  ].join('\n'));
  assert.equal(parsed.contacts.length, 0);
  assert.equal(parsed.skippedAmbiguous, 1);
  const dumped = JSON.stringify(parsed);
  assert.equal(dumped.includes('only a note'), false);
  assert.equal(dumped.includes('+15555550100'), false);
  assert.equal(dumped.includes('15555550177'), false);
  assert.equal(dumped.includes('Ada'), false);
});

test('rejects non-text and oversized input without throwing', () => {
  assert.deepEqual(parseVcf(null).errors, ['not-text']);
  const oversized = parseVcf(`BEGIN:VCARD\n${'A'.repeat(1_000_001)}\nEND:VCARD`);
  assert.deepEqual(oversized.errors, ['too-large']);
  assert.equal(oversized.contacts.length, 0);
});
