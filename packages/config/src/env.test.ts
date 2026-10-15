import { describe, expect, it } from 'vitest';

import { EnvValidationError, parseEnv } from './env.js';

describe('parseEnv', () => {
  it('fills in the defaults for an empty environment', () => {
    const env = parseEnv({});
    expect(env.OFFERPATH_API_PORT).toBe(50005);
    expect(env.OFFERPATH_WEB_PORT).toBe(50004);
    expect(env.OFFERPATH_CORS_ORIGINS).toEqual(['http://localhost:50004']);
    expect(env.REDIS_KEY_PREFIX).toBe('offerpath:');
    expect(env.OFFERPATH_SIGNUP).toBe('open');
    expect(env.REDIS_ENABLED).toBe(false);
  });

  it('coerces strings the way a .env file provides them', () => {
    const env = parseEnv({ OFFERPATH_API_PORT: '50015', REDIS_ENABLED: 'true' });
    expect(env.OFFERPATH_API_PORT).toBe(50015);
    expect(env.REDIS_ENABLED).toBe(true);
  });

  it('rejects a bad value with a readable message', () => {
    expect(() => parseEnv({ OFFERPATH_API_PORT: 'eighty' })).toThrow(EnvValidationError);
    expect(() => parseEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });
});
