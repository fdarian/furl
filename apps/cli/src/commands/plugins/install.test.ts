import { describe, expect, it } from 'bun:test';

import { registerInstalledPlugin } from './install';

describe('registerInstalledPlugin', () => {
  it('registers a new plugin at the front of the effective order', () => {
    const result = registerInstalledPlugin(
      { plugins: { existing: { token: 'keep' } } },
      ['default:*', 'default:jina'],
      'new-plugin',
    );

    expect(result).toEqual({
      order: ['plugin:new-plugin', 'default:*', 'default:jina'],
      plugins: {
        existing: { token: 'keep' },
        'new-plugin': {},
      },
    });
  });

  it('moves an existing plugin token to the front without duplicating it', () => {
    const config = {
      order: ['default:*', 'plugin:kept-plugin', 'plugin:kept-plugin'],
      plugins: {
        'kept-plugin': { token: 'keep' },
      },
    };

    const result = registerInstalledPlugin(config, config.order, 'kept-plugin');

    expect(result).toEqual({
      order: ['plugin:kept-plugin', 'default:*'],
      plugins: { 'kept-plugin': { token: 'keep' } },
    });
  });
});
