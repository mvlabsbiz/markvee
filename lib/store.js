'use strict';

function createMemoryStore() {
  const accounts = new Map();
  const byPhone = new Map();
  return {
    accounts,
    byPhone,
    sessions: new Map(),
    challenges: new Map(),
    directory: new Set(),
    rate: new Map(),
    changeRequests: new Map(),
    ownerNonces: new Map(),
    accountById(id) {
      return accounts.get(id) || null;
    },
    accountByPhone(hmac) {
      const id = byPhone.get(hmac);
      return id ? accounts.get(id) || null : null;
    },
  };
}

function createAccount(store, phoneHmac, access, phoneVerifiedAt) {
  const { randomId } = require('./crypto-util');
  const account = {
    id: randomId(16),
    phoneHmac,
    access,
    phoneVerifiedAt: phoneVerifiedAt || null,
    sessionGeneration: 1,
    introduction: '',
    evidenceNote: '',
    submittedAt: null,
  };
  store.accounts.set(account.id, account);
  store.byPhone.set(phoneHmac, account.id);
  return account;
}

module.exports = { createMemoryStore, createAccount };
