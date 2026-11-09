'use strict';

const { normalizePhone } = require('./phone');

const MAX_VCF_CHARS = 1_000_000;

/**
 * Parse a vCard file into matchable E.164 numbers.
 * Ambiguous numbers are counted and dropped so they cannot false-match.
 * Photo and note values are discarded.
 */
function parseVcf(text) {
  const empty = { contacts: [], skippedAmbiguous: 0, skippedInvalid: 0, errors: [] };
  if (typeof text !== 'string') {
    empty.errors.push('not-text');
    return empty;
  }
  if (text.length > MAX_VCF_CHARS) {
    empty.errors.push('too-large');
    return empty;
  }

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const unfolded = normalized.replace(/\n[ \t]/g, '');
  const contacts = [];
  let skippedAmbiguous = 0;
  let skippedInvalid = 0;
  const re = /BEGIN:VCARD\b([\s\S]*?)END:VCARD/gi;
  let match;
  while ((match = re.exec(unfolded))) {
    const parsed = parseCard(match[1]);
    skippedAmbiguous += parsed.skippedAmbiguous;
    skippedInvalid += parsed.skippedInvalid;
    if (parsed.phones.length) {
      contacts.push({ displayName: parsed.displayName, phones: parsed.phones });
    }
  }
  return { contacts, skippedAmbiguous, skippedInvalid, errors: [] };
}

function parseCard(body) {
  let displayName = '';
  let structuredName = '';
  const phones = [];
  let skippedAmbiguous = 0;
  let skippedInvalid = 0;

  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    const prop = parseProperty(line);
    if (!prop) continue;
    if (prop.name === 'FN' && prop.value) displayName = prop.value.slice(0, 200);
    else if (prop.name === 'N' && prop.value) structuredName = prop.value;
    else if (prop.name === 'TEL') {
      const norm = normalizePhone(extractTel(prop));
      if (norm.status === 'e164') phones.push(norm.e164);
      else if (norm.status === 'ambiguous') skippedAmbiguous += 1;
      else skippedInvalid += 1;
    }
  }

  return {
    displayName: displayName || formatN(structuredName),
    phones: [...new Set(phones)],
    skippedAmbiguous,
    skippedInvalid,
  };
}

function parseProperty(line) {
  let stage = 'name';
  let buf = '';
  let name = '';
  const params = [];
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
      buf += ch;
      continue;
    }
    if (!inQuote && stage !== 'value' && (ch === ';' || ch === ':')) {
      if (stage === 'name') name = buf;
      else params.push(buf);
      buf = '';
      stage = ch === ':' ? 'value' : 'params';
      continue;
    }
    buf += ch;
  }
  if (stage !== 'value') return null;

  let propName = name.trim();
  const dot = propName.lastIndexOf('.');
  if (dot !== -1) propName = propName.slice(dot + 1);
  propName = propName.toUpperCase();

  const parsedParams = {};
  for (const part of params) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      const token = unquote(part.trim());
      if (!token) continue;
      parsedParams.TYPE = (parsedParams.TYPE || []).concat(token);
      continue;
    }
    const key = part.slice(0, eq).trim().toUpperCase();
    const value = unquote(part.slice(eq + 1).trim());
    if (key === 'TYPE') {
      parsedParams.TYPE = (parsedParams.TYPE || []).concat(
        value.split(',').map((item) => item.trim()).filter(Boolean),
      );
    } else {
      parsedParams[key] = value;
    }
  }

  if (propName === 'PHOTO') return { name: propName, params: parsedParams, value: '' };
  const encoding = String(parsedParams.ENCODING || '').toUpperCase();
  if (encoding === 'B' || encoding === 'BASE64') {
    return { name: propName, params: parsedParams, value: '' };
  }
  let value = buf;
  if (encoding === 'QUOTED-PRINTABLE') value = decodeQuotedPrintable(value);
  value = unescapeText(value).trim();
  return { name: propName, params: parsedParams, value };
}

function extractTel(prop) {
  const valueType = String(prop.params.VALUE || '').toLowerCase();
  const value = prop.value.trim();
  if (valueType === 'uri' || /^tel:/i.test(value)) return value;
  return value;
}

function formatN(value) {
  if (!value) return '';
  const parts = value.split(';');
  const family = parts[0] || '';
  const given = parts[1] || '';
  const additional = parts[2] || '';
  const prefix = parts[3] || '';
  const suffix = parts[4] || '';
  return [prefix, given, additional, family, suffix].map((part) => part.trim()).filter(Boolean).join(' ').slice(0, 200);
}

function unquote(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function unescapeText(value) {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === 'n' || next === 'N') out += '\n';
      else if (next === '\\' || next === ';' || next === ',') out += next;
      else out += next;
      i += 1;
    } else {
      out += value[i];
    }
  }
  return out;
}

function decodeQuotedPrintable(value) {
  const cleaned = value.replace(/=\n/g, '');
  const bytes = [];
  for (let i = 0; i < cleaned.length; i += 1) {
    if (cleaned[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(cleaned.slice(i + 1, i + 3))) {
      bytes.push(parseInt(cleaned.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(cleaned.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

module.exports = { parseVcf };
