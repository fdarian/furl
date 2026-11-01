import { describe, expect, it } from 'bun:test';

import { KeychainError, PluginLoadError } from './errors.ts';

describe('error messages', () => {
  it('describes a KeychainError', () => {
    const error = new KeychainError({ cause: new Error('locked') });

    expect(error.message).toBe('Keychain access failed: locked');
  });

  it('describes a PluginLoadError as "path: cause"', () => {
    const error = new PluginLoadError({
      path: '/plugins/x',
      cause: new Error('no entrypoint'),
    });

    expect(error.message).toBe('/plugins/x: no entrypoint');
  });
});
