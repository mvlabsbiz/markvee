'use strict';

/**
 * Delivery gate.
 * The in-memory courier exists only for tests. Production, development, and
 * any process with NODE_ENV=production fail closed and keep no code.
 * There is no live SMS transport in this branch.
 */
function createCourier({ runtime, delivery, allowTestDelivery, nodeEnv } = {}) {
  const env = nodeEnv === undefined ? process.env.NODE_ENV : nodeEnv;
  const testCourier = runtime === 'test'
    && delivery === 'fake'
    && allowTestDelivery === true
    && env !== 'production';
  if (!testCourier) {
    return {
      mode: 'fail-closed',
      async send() {
        return { delivered: false, reason: 'delivery_not_configured' };
      },
    };
  }

  const sent = [];
  return {
    mode: 'fake',
    async send(message) {
      sent.push({ e164: message.e164, code: message.code });
      return { delivered: true };
    },
    takeCodeForTests(e164) {
      for (let i = sent.length - 1; i >= 0; i -= 1) {
        if (sent[i].e164 === e164) return sent[i].code;
      }
      return null;
    },
    sentCount() {
      return sent.length;
    },
  };
}

module.exports = { createCourier };
