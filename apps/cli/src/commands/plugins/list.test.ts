import { describe, expect, it } from 'bun:test';

import { formatPluginLine } from './list';

describe('formatPluginLine', () => {
  it('marks a plugin enabled when plugin:<name> is in order', () => {
    expect(
      formatPluginLine('alpha', '/p/alpha', ['plugin:alpha', 'default:*']),
    ).toBe('alpha  (enabled) - /p/alpha');
  });

  it('marks a plugin disabled when it is not in order', () => {
    expect(formatPluginLine('alpha', '/p/alpha', ['default:*'])).toBe(
      'alpha  (disabled) - /p/alpha',
    );
  });
});
