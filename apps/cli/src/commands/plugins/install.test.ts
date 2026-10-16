import { describe, expect, it } from 'bun:test';
import { Option } from 'effect';

import { describePreview } from './install';

describe('describePreview', () => {
  it('shows only the URL when package.json is absent', () => {
    expect(
      describePreview({
        url: 'https://github.com/foo/bar',
        packageName: Option.none(),
        packageDescription: Option.none(),
      }),
    ).toEqual(['Source: https://github.com/foo/bar']);
  });

  it('adds the package name and description when present', () => {
    expect(
      describePreview({
        url: 'https://github.com/foo/bar',
        packageName: Option.some('furl-x'),
        packageDescription: Option.some('does x'),
      }),
    ).toEqual([
      'Source: https://github.com/foo/bar',
      'Package: furl-x',
      'Description: does x',
    ]);
  });
});
