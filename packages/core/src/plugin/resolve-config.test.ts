import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';

import { resolvePluginConfig } from './resolve-config.ts';
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
    const secrets = makeSecretsStub({ 'x-api-key': 'real-key' });

    const resolved = await Effect.runPromise(
      resolvePluginConfig(secrets, 'x', { apiKey: 'secret:x-api-key' }),
    );

    expect(resolved).toEqual({ apiKey: 'real-key' });
  });

  it('substitutes "secret:<name>" strings nested in arrays and objects', async () => {
    const secrets = makeSecretsStub({ a: 'A', b: 'B' });

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

  it('fails with a ResolverError when the referenced secret is missing', async () => {
    const secrets = makeSecretsStub();

    const error = await Effect.runPromise(
      Effect.flip(
        resolvePluginConfig(secrets, 'x', { apiKey: 'secret:missing' }),
      ),
    );

    expect(error._tag).toBe('ResolverError');
    expect(error.id).toBe('x');
    expect(String(error.cause)).toContain('missing');
  });

  it('requires an exact "secret:" prefix, not just a leading "secret"', async () => {
    const resolved = await Effect.runPromise(
      resolvePluginConfig(makeSecretsStub(), 'x', {
        role: 'secretary',
      }),
    );

    expect(resolved).toEqual({ role: 'secretary' });
  });
});
