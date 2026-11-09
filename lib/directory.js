'use strict';

const { normalizePhone } = require('./phone');
const { phoneKey } = require('./crypto-util');

/** Replace the designated contact source. Stores keyed digests, never raw numbers. */
function replaceDirectory(store, pepper, contacts) {
  store.directory.clear();
  let imported = 0;
  for (const contact of contacts || []) {
    for (const phone of contact.phones || []) {
      const norm = normalizePhone(phone);
      if (norm.status !== 'e164') continue;
      const key = phoneKey(pepper, norm.e164);
      if (!store.directory.has(key)) {
        store.directory.add(key);
        imported += 1;
      }
    }
  }
  return imported;
}

module.exports = { replaceDirectory };
