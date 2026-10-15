import { describe, expect, it } from 'vitest';

import { EnvValidationError, parseEnv } from './env.js';

describe('parseEnv', () => {
  it('fills in the defaults for an empty environment', () => {
    const env = parseEnv({});
    expect(env.OFFERPATH_PORT).toBe(50010);
    expect(env.REDIS_KEY_PREFIX).toBe('offerpath:');
    expect(env.OFFERPATH_SIGNUP).toBe('open');
    expect(env.REDIS_ENABLED).toBe(false);
  });

  it('coerces strings the way a .env file provides them', () => {
    const env = parseEnv({ OFFERPATH_PORT: '50011', REDIS_ENABLED: 'true' });
    expect(env.OFFERPATH_PORT).toBe(50011);
    expect(env.REDIS_ENABLED).toBe(true);
  });

  it('rejects a bad value with a readable message', () => {
    expect(() => parseEnv({ OFFERPATH_PORT: 'eighty' })).toThrow(EnvValidationError);
    expect(() => parseEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });
});
