import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';

import type { FurlConfigServiceShape } from './config-service.ts';
import { fetchMarkdown } from './fetch-markdown.ts';
import type { PluginDiscovery } from './plugin/discovery.ts';
import { makeHttpClientStub, makeSecretsStub } from './plugin/test-doubles.ts';

const makeConfig = (order: readonly string[]): FurlConfigServiceShape => ({
  read: Effect.succeed({ order: order }),
  resolveProvider: Effect.die('unused'),
  resolveOrder: Effect.succeed(order),
  write: () => Effect.die('unused'),
});

const makeDiscovery = (onDiscover: () => void) => ({
  discover: Effect.sync(() => {
    onDiscover();
    return [];
  }),
});

const run = (
  order: readonly string[],
  options: { resolvers?: readonly string[] } = {},
) => {
  let discoveries = 0;
  const effect = fetchMarkdown(
    makeHttpClientStub(() => new Response('# hi', { status: 200 })),
    makeConfig(order),
    makeSecretsStub(),
    makeDiscovery(() => {
      discoveries += 1;
    }) as PluginDiscovery['Service'],
    'https://example.com/file.md',
    options,
  );

  return { effect: effect, discoveries: () => discoveries };
};

describe('fetchMarkdown', () => {
  it('does not run plugin discovery when no plugin token is listed', async () => {
    const scenario = run(['default:*']);

    const result = await Effect.runPromise(scenario.effect);

    expect(result).toEqual({ markdown: '# hi', source: 'default:raw' });
    expect(scenario.discoveries()).toBe(0);
  });

  it('runs plugin discovery when a plugin token is listed', async () => {
    const scenario = run(['plugin:alpha']);

    const error = await Effect.runPromise(Effect.flip(scenario.effect));

    expect(scenario.discoveries()).toBe(1);
    expect(error._tag).toBe('ConfigError');
  });

  it('rejects an invalid token before running plugin discovery', async () => {
    const scenario = run(['plugin:alpha', 'bogus']);

    const error = await Effect.runPromise(Effect.flip(scenario.effect));

    expect(error._tag).toBe('ConfigError');
    expect(error.message).toContain('Invalid order token "bogus"');
    expect(scenario.discoveries()).toBe(0);
  });

  it('rejects an empty --resolvers override', async () => {
    const scenario = run(['default:*'], { resolvers: [] });

    const error = await Effect.runPromise(Effect.flip(scenario.effect));

    expect(error._tag).toBe('ConfigError');
    expect(error.message).toBe('order must contain at least one token');
  });

  it('rejects an empty configured order', async () => {
    const error = await Effect.runPromise(Effect.flip(run([]).effect));

    expect(error.message).toBe('order must contain at least one token');
  });
});
