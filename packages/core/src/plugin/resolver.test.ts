import { describe, expect, it } from 'bun:test';

import { computeSpecificity, matchAnySpecificity } from './resolver.ts';

describe('computeSpecificity', () => {
  it('assigns matchAnySpecificity to a null matcher', () => {
    expect(computeSpecificity(null)).toBe(matchAnySpecificity);
  });

  it('ranks a hostname-only matcher above matchAnySpecificity', () => {
    const specificity = computeSpecificity({ hostname: 'x.com' });
    expect(specificity).toBeGreaterThan(matchAnySpecificity);
  });

  it('ranks more literal path segments as more specific', () => {
    const oneSegment = computeSpecificity({
      hostname: 'x.com',
      path: '/status/*',
    });
    const twoSegments = computeSpecificity({
      hostname: 'x.com',
      path: '/*/status/replies',
    });

    expect(twoSegments).toBeGreaterThan(oneSegment);
  });

  it('ranks a path constraint (even all-wildcard segments) above no path at all', () => {
    const wildcardPath = computeSpecificity({ hostname: 'x.com', path: '/*' });
    const noPath = computeSpecificity({ hostname: 'x.com' });

    expect(wildcardPath).toBeGreaterThan(noPath);
  });
});
