import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';

import { KeychainError } from '../errors.ts';
import {
  deleteGenericSecret,
  findPluginSecretNames,
  genericSecretAccount,
  resolvePluginConfig,
  secretNameFor,
  setGenericSecret,
} from './resolve-config.ts';
import { makeSecretsStub } from './test-doubles.ts';

describe('resolvePluginConfig', () => {
  it('returns an empty object when args are undefined', async () => {
    const resolved = await Effect.runPromise(
      resolvePluginConfig(makeSecretsStub(), 'x', undefined),
    );

    expect(resolved).toEqual({});
  });

  it('passes non-secret values through untouched', async () => {
    const resolved = await Effect.runPromise(
      resolvePluginConfig(makeSecretsStub(), 'x', {
        mode: 'metadata',
        retries: 3,
        enabled: true,
      }),
    );

    expect(resolved).toEqual({ mode: 'metadata', retries: 3, enabled: true });
  });

  it('substitutes a top-level "secret:<name>" string with its keychain value', async () => {
    const secrets = makeSecretsStub({ 'secret/x-api-key': 'real-key' });

    const resolved = await Effect.runPromise(
      resolvePluginConfig(secrets, 'x', { apiKey: 'secret:x-api-key' }),
    );

    expect(resolved).toEqual({ apiKey: 'real-key' });
  });

  it('substitutes "secret:<name>" strings nested in arrays and objects', async () => {
    const secrets = makeSecretsStub({ 'secret/a': 'A', 'secret/b': 'B' });

    const resolved = await Effect.runPromise(
      resolvePluginConfig(secrets, 'x', {
        list: ['secret:a', 'plain'],
        nested: { inner: 'secret:b' },
      }),
    );

    expect(resolved).toEqual({
      list: ['A', 'plain'],
      nested: { inner: 'B' },
    });
  });

  it('fails with a ConfigError when the referenced secret is missing', async () => {
    const secrets = makeSecretsStub();

    const error = await Effect.runPromise(
      Effect.flip(
        resolvePluginConfig(secrets, 'x', { apiKey: 'secret:missing' }),
      ),
    );

    expect(error._tag).toBe('ConfigError');
    expect(error.message).toContain('"missing"');
    expect(error.message).toContain('plugin "x"');
  });

  it('fails with a ConfigError when the keychain cannot be read', async () => {
    const secrets = {
      ...makeSecretsStub(),
      get: () => Effect.fail(new KeychainError({ cause: new Error('locked') })),
    };

    const error = await Effect.runPromise(
      Effect.flip(resolvePluginConfig(secrets, 'x', { apiKey: 'secret:k' })),
    );

    expect(error._tag).toBe('ConfigError');
    expect(error.message).toContain('"k"');
    expect(error.message).toContain('locked');
  });

  it('requires an exact "secret:" prefix, not just a leading "secret"', async () => {
    const resolved = await Effect.runPromise(
      resolvePluginConfig(makeSecretsStub(), 'x', {
        role: 'secretary',
      }),
    );

    expect(resolved).toEqual({ role: 'secretary' });
  });

  it('does not resolve a secret stored under a bare provider account', async () => {
    const secrets = makeSecretsStub({ exa: 'provider-key' });

    const error = await Effect.runPromise(
      Effect.flip(resolvePluginConfig(secrets, 'x', { apiKey: 'secret:exa' })),
    );

    expect(error._tag).toBe('ConfigError');
  });

  it('rejects an empty "secret:" reference', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        resolvePluginConfig(makeSecretsStub(), 'x', { apiKey: 'secret:' }),
      ),
    );

    expect(error._tag).toBe('ConfigError');
    expect(error.message).toContain('Empty secret reference');
  });
});

describe('secretNameFor', () => {
  it('scopes the field key under the plugin id', () => {
    expect(secretNameFor('exa-search', 'apiKey')).toBe('exa-search.apiKey');
  });

  it('keeps same-named fields of different plugins apart', () => {
    expect(secretNameFor('a', 'token')).not.toBe(secretNameFor('b', 'token'));
  });
});

describe('generic secret storage', () => {
  it('stores under the "secret/" account, away from provider keys', async () => {
    const secrets = makeSecretsStub({ exa: 'provider-key' });

    await Effect.runPromise(setGenericSecret(secrets, 'exa', 'generic'));

    expect(genericSecretAccount('exa')).toBe('secret/exa');
    expect(await Effect.runPromise(secrets.get('exa'))).toBe('provider-key');
    expect(await Effect.runPromise(secrets.get('secret/exa'))).toBe('generic');
  });

  it('rejects an empty name', async () => {
    const error = await Effect.runPromise(
      Effect.flip(setGenericSecret(makeSecretsStub(), '  ', 'value')),
    );

    expect(error._tag).toBe('InvalidSecretError');
    expect(error.message).toContain('name');
  });

  it('rejects an empty value without touching the keychain', async () => {
    const secrets = makeSecretsStub({ 'secret/x': 'kept' });

    const error = await Effect.runPromise(
      Effect.flip(setGenericSecret(secrets, 'x', '')),
    );

    expect(error._tag).toBe('InvalidSecretError');
    expect(error.message).toContain('value');
    expect(await Effect.runPromise(secrets.get('secret/x'))).toBe('kept');
  });

  it('deletes from the generic account only', async () => {
    const secrets = makeSecretsStub({ x: 'provider', 'secret/x': 'generic' });

    await Effect.runPromise(deleteGenericSecret(secrets, 'x'));

    expect(await Effect.runPromise(secrets.get('x'))).toBe('provider');
    expect(await Effect.runPromise(secrets.get('secret/x'))).toBeNull();
  });
});

describe('findPluginSecretNames', () => {
  it('finds references to the plugin deep in nested values', () => {
    const names = findPluginSecretNames('x', {
      apiKey: 'secret:x.apiKey',
      nested: { list: ['secret:x.token', 'plain', { deep: 'secret:x.deep' }] },
      count: 3,
      nothing: null,
    });

    expect(names).toEqual(['x.apiKey', 'x.token', 'x.deep']);
  });

  it("ignores shared or other plugins' references", () => {
    expect(
      findPluginSecretNames('x', {
        shared: 'secret:x-api-key',
        other: 'secret:y.apiKey',
        lookalike: 'secret:xy.apiKey',
      }),
    ).toEqual([]);
  });
});
