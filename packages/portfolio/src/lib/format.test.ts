import { describe, expect, it } from 'vitest';

import {
  handleProblem,
  imageProblem,
  isHexColour,
  moveId,
  moveIdTo,
  netlifySnippet,
  normaliseHex,
  originOf,
  publicSiteUrl,
  textToParagraphs,
} from './format';

describe('portfolio helpers', () => {
  it('validates handles like the API: 3–40 lowercase letters, digits and dashes', () => {
    expect(handleProblem('portfolio')).toBeNull();
    expect(handleProblem('a-1')).toBeNull();
    expect(handleProblem('ab')).toBe('Use at least 3 characters.');
    expect(handleProblem('x'.repeat(41))).toBe('Use at most 40 characters.');
    expect(handleProblem('My_Site')).toBe('Use lowercase letters, digits and dashes only.');
  });

  it('accepts only 6-digit hex colours', () => {
    expect(isHexColour('#a1B2c3')).toBe(true);
    expect(isHexColour('#abc')).toBe(false);
    expect(isHexColour('a1b2c3')).toBe(false);
    expect(normaliseHex(' #A1B2C3 ')).toBe('#a1b2c3');
    expect(normaliseHex('red')).toBeNull();
  });

  it('splits paragraphs on blank lines only', () => {
    expect(textToParagraphs('One\nstill one\n\n\nTwo\n  \nThree')).toEqual([
      'One\nstill one',
      'Two',
      'Three',
    ]);
  });

  it('builds the public URL and the Netlify proxy from the API origin', () => {
    const url = publicSiteUrl('http://10.0.0.5:50005/', '/api/v1/public/portfolio/me/site');
    expect(url).toBe('http://10.0.0.5:50005/api/v1/public/portfolio/me/site');
    expect(publicSiteUrl(null, '/x/site')).toBe('/x/site');
    const toml = netlifySnippet(url);
    expect(toml).toContain('from = "/api/site"');
    expect(toml).toContain('to = "http://10.0.0.5:50005/api/v1/public/portfolio/me/contact"');
    expect(originOf('http://10.0.0.5:50005/api')).toBe('http://10.0.0.5:50005');
    expect(originOf('not a url')).toBeNull();
  });

  it('checks image type and size before uploading', () => {
    expect(imageProblem({ type: 'image/webp', size: 1000 })).toBeNull();
    expect(imageProblem({ type: 'image/svg+xml', size: 10 })).toMatch(/PNG, JPG/);
    expect(imageProblem({ type: 'image/png', size: 9 * 1024 * 1024 })).toMatch(/8 MB/);
  });

  it('moves ids by one place or onto another', () => {
    expect(moveId(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    const ids = ['a', 'b'];
    expect(moveId(ids, 'a', -1)).toBe(ids);
    expect(moveIdTo(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
  });
});
