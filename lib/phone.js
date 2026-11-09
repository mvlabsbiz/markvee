'use strict';

/**
 * Conservative phone normalization.
 * Only an explicit international number becomes E.164.
 * Missing or ambiguous country codes never compare equal to a contact.
 */

function normalizePhone(input) {
  if (typeof input !== 'string') return { status: 'invalid' };
  let raw = input.trim();
  if (!raw) return { status: 'invalid' };

  if (/^tel:/i.test(raw)) {
    raw = raw.replace(/^tel:/i, '');
    const query = raw.indexOf('?');
    if (query !== -1) raw = raw.slice(0, query);
    try {
      raw = decodeURIComponent(raw);
    } catch {
      return { status: 'invalid' };
    }
    raw = raw.trim();
  }

  if ((raw.match(/\+/g) || []).length > 1) return { status: 'invalid' };
  if (raw.includes('+') && !/^\+/.test(raw)) return { status: 'invalid' };

  const stripped = stripExtension(raw);
  if (/[^\d\s().+\-]/.test(stripped.main)) return { status: 'invalid' };
  if (hasSubscriberLetters(stripped.main)) return { status: 'invalid' };

  let digits = stripped.main.replace(/\D/g, '');
  if (!digits) return { status: 'invalid' };

  const explicitPlus = stripped.main.trim().startsWith('+');
  if (!explicitPlus) {
    if (digits.startsWith('00')) {
      digits = digits.slice(2);
      if (!isE164Digits(digits)) return { status: 'invalid' };
      return { status: 'e164', e164: `+${digits}` };
    }
    if (digits.startsWith('011')) {
      digits = digits.slice(3);
      if (!isE164Digits(digits)) return { status: 'invalid' };
      return { status: 'e164', e164: `+${digits}` };
    }
    return { status: 'ambiguous' };
  }

  if (!isE164Digits(digits)) return { status: 'invalid' };
  return { status: 'e164', e164: `+${digits}` };
}

function stripExtension(raw) {
  let main = raw;
  const rfc = main.match(/^(.*?);(?:ext|isub)=[^;]*$/i);
  if (rfc) main = rfc[1];
  const labeled = main.match(/^(.*?)(?:\s+(?:ext\.?|extension|x))\s*\d+\s*$/i);
  if (labeled && /\d/.test(labeled[1])) main = labeled[1];
  return { main: main.trim() };
}

function hasSubscriberLetters(value) {
  return /[A-Za-z]/.test(value);
}

function isE164Digits(digits) {
  return /^[1-9]\d{7,14}$/.test(digits);
}

function sameE164(left, right) {
  const a = normalizePhone(left);
  const b = normalizePhone(right);
  return a.status === 'e164' && b.status === 'e164' && a.e164 === b.e164;
}

module.exports = { normalizePhone, sameE164 };
