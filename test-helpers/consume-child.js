'use strict';

if (process.env.MARKVEE_CONSUME_CHILD === '1') {
  const { createDurableStore } = require('../lib/durable-store');
  const { createChallengeService } = require('../lib/challenges');
  const { createCourier } = require('../lib/delivery');

  const store = createDurableStore(process.env.MARKVEE_STORE);
  const challenges = createChallengeService({
    store,
    courier: createCourier({ runtime: 'production', nodeEnv: 'production' }),
    policy: JSON.parse(process.env.MARKVEE_POLICY),
    pepper: process.env.MARKVEE_PEPPER,
    now: () => Number(process.env.MARKVEE_NOW),
  });
  const result = challenges.verify({
    e164: process.env.MARKVEE_E164,
    code: process.env.MARKVEE_CODE,
    ip: process.env.MARKVEE_IP,
  });
  store.close();
  process.exit(result.ok ? 0 : 1);
}
