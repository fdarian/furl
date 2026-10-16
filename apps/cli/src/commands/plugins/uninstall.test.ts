import { describe, expect, it } from 'bun:test';
import type { DiscoveredPlugin } from '@furl/core';

import { secretNamesToDelete } from './uninstall';

const makePlugin = (
  config: NonNullable<DiscoveredPlugin['manifest']['config']>,
): DiscoveredPlugin => ({
  name: 'x',
  folder: '/plugins/x',
  entrypoint: '/plugins/x/index.ts',
  manifest: {
    name: 'x',
    match: { hostname: 'x.com' },
    config: config,
    resolve: () => null,
  },
});

describe('secretNamesToDelete', () => {
  it('includes declared secret fields even when config has no reference', () => {
    const plugin = makePlugin([
      { key: 'apiKey', type: 'secret' },
      { key: 'mode', type: 'string' },
    ]);

    expect(secretNamesToDelete(plugin, {})).toEqual(['x.apiKey']);
  });

  it('includes undeclared references found deep in the plugin config', () => {
    const plugin = makePlugin([{ key: 'apiKey', type: 'secret' }]);

    const names = secretNamesToDelete(plugin, {
      plugins: {
        x: {
          apiKey: 'secret:x.apiKey',
          nested: { list: [{ token: 'secret:x.token' }] },
        },
      },
    });

    expect(names).toEqual(['x.apiKey', 'x.token']);
  });

  it("leaves shared secrets and other plugins' secrets alone", () => {
    const plugin = makePlugin([]);

    const names = secretNamesToDelete(plugin, {
      plugins: {
        x: { shared: 'secret:x-api-key', other: 'secret:y.apiKey' },
        y: { apiKey: 'secret:x.apiKey' },
      },
    });

    expect(names).toEqual([]);
  });
});
