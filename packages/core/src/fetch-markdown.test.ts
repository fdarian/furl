import { describe, expect, it } from 'bun:test';

import { shouldDiscoverPlugins } from './fetch-markdown.ts';

describe('shouldDiscoverPlugins', () => {
  it('does not discover plugins when the order has no plugin token', () => {
    expect(shouldDiscoverPlugins(['default:*'], undefined)).toBe(false);
  });

  it('discovers plugins when the order explicitly names one', () => {
    expect(
      shouldDiscoverPlugins(['default:raw', 'plugin:alpha'], undefined),
    ).toBe(true);
  });

  it('does not discover plugins when --no-plugins disables them', () => {
    expect(shouldDiscoverPlugins(['plugin:alpha'], true)).toBe(false);
  });
});
