import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect } from 'effect';
import { AllResolversFailed, describeCause } from 'furl-core';

import { MissingProviderKeyError } from '../errors.ts';
import { createDefaultResolvers } from './default-resolvers.ts';
import { makeSecretsStub, withUnusedHttpClient } from './test-doubles.ts';

const noEnv = ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }));
const url = new URL('https://example.com/page');

const resolverById = (
  secrets: ReturnType<typeof makeSecretsStub>,
  id: string,
) => {
  const resolver = createDefaultResolvers(secrets).find(
    (candidate) => candidate.id === id,
  );

  if (resolver === undefined) {
    throw new Error(`No default resolver ${id}`);
  }

  return resolver;
};

describe('createDefaultResolvers keys', () => {
  for (const provider of ['exa', 'firecrawl']) {
    it(`fails ${provider} with the CLI hint when neither env nor keychain has a key`, async () => {
      const resolver = resolverById(makeSecretsStub(), `default:${provider}`);

      const error = await Effect.runPromise(
        Effect.flip(withUnusedHttpClient(resolver.run(url))).pipe(
          Effect.provide(noEnv),
        ),
      );

      expect(error._tag).toBe('ResolverError');
      expect(error.cause).toBeInstanceOf(MissingProviderKeyError);
      expect(describeCause(error.cause)).toBe(
        `No API key configured for ${provider}. Run \`furl providers\`.`,
      );
    });
  }

  it('shows the CLI hint when AllResolversFailed lists the missing key', () => {
    const error = new AllResolversFailed({
      url: url.toString(),
      failures: [
        {
          id: 'default:exa',
          cause: new MissingProviderKeyError({ provider: 'exa' }),
        },
      ],
    });

    expect(error.message).toContain(
      'default:exa (No API key configured for exa. Run `furl providers`.)',
    );
  });

  it('lets jina run keyless when neither env nor keychain has a key', async () => {
    const resolver = resolverById(makeSecretsStub(), 'default:jina');

    const error = await Effect.runPromise(
      Effect.flip(withUnusedHttpClient(resolver.run(url))).pipe(
        Effect.provide(noEnv),
      ),
    ).catch((thrown: unknown) => thrown);

    expect(error).not.toBeInstanceOf(MissingProviderKeyError);
  });
});
