import { describe, expect, it } from 'vitest';

import {
  type JobHunterAccount,
  parseTimestamp,
  resolveUser,
  stripNul,
  toSyncRow,
} from './job-hunter-transform.js';

const NOW = new Date('2026-10-15T12:00:00.000Z');

const account: JobHunterAccount = {
  _id: 'jh-1',
  email: ' Me@Example.com ',
  passwordHash: '$2a$12$jh',
  displayName: 'Me (JH)',
  createdAt: '2026-09-26T08:39:58.086Z',
};

describe('resolveUser', () => {
  it('keeps a user already in Offerpath', () => {
    const r = resolveUser(account, { id: 'op-1' }, undefined);
    expect(r.source).toBe('offerpath');
    expect(r.seed.id).toBe('op-1');
  });

  it('takes the ForgeRoutine identity when the email is there', () => {
    const fr = {
      id: 'fr-1',
      email: 'me@example.com',
      passwordHash: '$2a$12$fr',
      displayName: 'Me (FR)',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const r = resolveUser(account, undefined, fr);
    expect(r.source).toBe('forgeroutine');
    expect(r.seed).toMatchObject({
      id: 'fr-1',
      passwordHash: '$2a$12$fr',
      email: 'me@example.com',
    });
  });

  it('falls back to the Job Hunter account, hash unchanged and email normalised', () => {
    const r = resolveUser(account, undefined, undefined);
    expect(r.source).toBe('job-hunter');
    expect(r.seed).toMatchObject({
      id: 'jh-1',
      email: 'me@example.com',
      passwordHash: '$2a$12$jh',
      displayName: 'Me (JH)',
    });
    expect(r.seed.createdAt.toISOString()).toBe('2026-09-26T08:39:58.086Z');
  });
});

describe('parseTimestamp', () => {
  it('reads the Rust core nanosecond timestamps', () => {
    expect(parseTimestamp('2026-09-27T21:59:47.231250700Z')?.toISOString()).toBe(
      '2026-09-27T21:59:47.231Z',
    );
  });

  it('ignores anything that is not a timestamp', () => {
    expect(parseTimestamp('soon')).toBeUndefined();
    expect(parseTimestamp(42)).toBeUndefined();
    expect(parseTimestamp(undefined)).toBeUndefined();
  });
});

describe('toSyncRow', () => {
  const map = new Map([['jh-1', 'fr-1']]);

  it('re-points the document to the new user and keeps every field', () => {
    const row = toSyncRow(
      'jobs',
      {
        _id: 'jh-1:job-9',
        id: 'job-9',
        userId: 'jh-1',
        title: 'Engineer',
        updatedAt: '2026-09-27T21:59:47.231250700Z',
      },
      map,
      NOW,
    );
    expect(row).toEqual({
      userId: 'fr-1',
      collection: 'jobs',
      id: 'job-9',
      doc: {
        id: 'job-9',
        userId: 'fr-1',
        title: 'Engineer',
        updatedAt: '2026-09-27T21:59:47.231250700Z',
      },
      updatedAt: new Date('2026-09-27T21:59:47.231Z'),
    });
  });

  it('takes the id from the scoped Mongo key when the document has none', () => {
    const row = toSyncRow('settings', { _id: 'jh-1:general', userId: 'jh-1' }, map, NOW);
    expect(row?.id).toBe('general');
    expect(row?.updatedAt).toBe(NOW);
  });

  it('skips documents of unknown owners', () => {
    expect(
      toSyncRow('jobs', { _id: 'x:1', id: '1', userId: 'someone-else' }, map, NOW),
    ).toBeUndefined();
    expect(toSyncRow('jobs', { _id: '1', id: '1' }, map, NOW)).toBeUndefined();
  });
});

describe('stripNul', () => {
  it('removes NUL characters jsonb would reject, deep inside', () => {
    expect(stripNul({ a: ['x\u0000y'], b: { c: '\u0000' }, d: 1 })).toEqual({
      a: ['xy'],
      b: { c: '' },
      d: 1,
    });
  });
});
