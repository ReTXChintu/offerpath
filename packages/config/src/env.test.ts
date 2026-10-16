import { describe, expect, it } from 'vitest';

import { ConfigurationError, parseEnv } from './load.js';

const REQUIRED = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/offerpath',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('parseEnv', () => {
  it('fills in the defaults', () => {
    const env = parseEnv(REQUIRED);
    expect(env.OFFERPATH_API_PORT).toBe(50005);
    expect(env.OFFERPATH_WEB_PORT).toBe(50004);
    expect(env.REDIS_KEY_PREFIX).toBe('offerpath:');
    expect(env.OFFERPATH_SIGNUP).toBe('open');
    expect(env.REDIS_ENABLED).toBe(false);
  });

  it('coerces strings the way a .env file provides them', () => {
    const env = parseEnv({ ...REQUIRED, OFFERPATH_API_PORT: '50015', REDIS_ENABLED: 'true' });
    expect(env.OFFERPATH_API_PORT).toBe(50015);
    expect(env.REDIS_ENABLED).toBe(true);
  });

  it('rejects a bad value with a readable message', () => {
    expect(() => parseEnv({ ...REQUIRED, OFFERPATH_API_PORT: 'eighty' })).toThrow(
      ConfigurationError,
    );
    expect(() => parseEnv({ ...REQUIRED, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...REQUIRED, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('refuses shared or default JWT secrets in production', () => {
    expect(() =>
      parseEnv({ ...REQUIRED, NODE_ENV: 'production', JWT_REFRESH_SECRET: 'a'.repeat(32) }),
    ).toThrow(/must differ/);
    expect(() =>
      parseEnv({ ...REQUIRED, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'change-me'.repeat(4) }),
    ).toThrow(/Default JWT secret/);
  });
});
