import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';

import type {
  FurlConfigServiceShape,
  PluginConfigValue,
} from '../config-service.ts';
import type { DiscoveredPlugin } from './discovery.ts';
import {
  buildResolverList,
  matchesUrl,
  parseOrderToken,
  toPluginResolver,
} from './order.ts';
import type { Resolver } from './resolver.ts';
import { computeSpecificity } from './resolver.ts';
import { makeSecretsStub } from './test-doubles.ts';
import { ResolveDecline } from './types.ts';

const runFail = <A, E>(effect: Effect.Effect<A, E>): Promise<E> =>
  Effect.runPromise(Effect.flip(effect));

const makeConfigStub = (
  options: {
    order?: readonly string[];
    plugins?: Readonly<Record<string, PluginConfigValue>>;
  } = {},
): FurlConfigServiceShape => ({
  read: Effect.succeed({ order: options.order, plugins: options.plugins }),
  resolveProvider: () => Effect.succeed('jina'),
  resolveOrder: Effect.succeed(
    options.order ?? [
      'default:raw',
      'default:direct',
      'default:md-suffix',
      'default:jina',
    ],
  ),
  pluginArgs: (id) => Effect.succeed(options.plugins?.[id]),
  write: () => Effect.succeed(undefined),
});

const makePlugin = (
  name: string,
  match: DiscoveredPlugin['manifest']['match'] = { hostname: 'x.com' },
): DiscoveredPlugin => ({
  name: name,
  folder: `/plugins/${name}`,
  entrypoint: `/plugins/${name}/index.ts`,
  manifest: {
    name: name,
    match: match,
    resolve: () => null,
  },
});

const makeDefaultResolvers = (): Resolver[] =>
  ['raw', 'direct', 'md-suffix', 'jina', 'firecrawl', 'exa'].map((id) => ({
    id: id,
    isDefault: true,
    match: null,
    specificity: -1,
    run: () => Effect.succeed(new ResolveDecline()),
  }));

describe('parseOrderToken', () => {
  it('parses the default wildcard', async () => {
    const token = await Effect.runPromise(parseOrderToken('default:*'));
    expect(token).toEqual({ _tag: 'default-wildcard' });
  });

  it('parses a known built-in token', async () => {
    const token = await Effect.runPromise(parseOrderToken('default:firecrawl'));
    expect(token).toEqual({ _tag: 'default', name: 'firecrawl' });
  });

  it('parses a namespaced plugin token', async () => {
    const token = await Effect.runPromise(parseOrderToken('plugin:alpha'));
    expect(token).toEqual({ _tag: 'plugin', name: 'alpha' });
  });

  it('rejects a bare wildcard and bare plugin id', async () => {
    const wildcardError = await runFail(parseOrderToken('*'));
    const pluginError = await runFail(parseOrderToken('alpha'));

    expect(String(wildcardError.cause)).toContain('Invalid order token');
    expect(wildcardError.message).toContain('default:<builtin-name>');
    expect(String(pluginError.cause)).toContain('plugin:<plugin-name>');
  });

  it('rejects an unknown built-in and an empty plugin name', async () => {
    const builtinError = await runFail(parseOrderToken('default:bogus'));
    const pluginError = await runFail(parseOrderToken('plugin:'));

    expect(String(builtinError.cause)).toContain('bogus');
    expect(String(pluginError.cause)).toContain('Invalid order token');
  });
});

describe('matchesUrl', () => {
  const url = new URL('https://x.com/someone/status/123');

  it('matches any URL for a null pattern', () => {
    expect(matchesUrl(null, url)).toBe(true);
  });

  it('matches host and one-segment wildcards', () => {
    expect(matchesUrl({ hostname: 'x.com', path: '/*/status/*' }, url)).toBe(
      true,
    );
    expect(matchesUrl({ hostname: 'other.com' }, url)).toBe(false);
  });
});

describe('buildResolverList', () => {
  const url = new URL('https://x.com/someone/status/123');
  const secrets = makeSecretsStub();
  const defaultResolvers = makeDefaultResolvers();

  it('expands default:* to raw, direct, and md-suffix only', async () => {
    const result = await Effect.runPromise(
      buildResolverList(
        makeConfigStub({ order: ['default:*'] }),
        secrets,
        url,
        defaultResolvers,
        [],
      ),
    );

    expect(result.map((resolver) => resolver.id)).toEqual([
      'raw',
      'direct',
      'md-suffix',
    ]);
  });

  it('runs a discovered plugin only when plugin:<name> is listed', async () => {
    const plugin = makePlugin('alpha');
    const discovered = await Effect.runPromise(
      buildResolverList(
        makeConfigStub({ order: ['default:*'] }),
        secrets,
        url,
        defaultResolvers,
        [plugin],
      ),
    );
    const listed = await Effect.runPromise(
      buildResolverList(
        makeConfigStub({ order: ['plugin:alpha'] }),
        secrets,
        url,
        defaultResolvers,
        [plugin],
      ),
    );

    expect(discovered.map((resolver) => resolver.id)).not.toContain('alpha');
    expect(listed.map((resolver) => resolver.id)).toEqual(['alpha']);
  });

  it('rejects a plugin token when the plugin was not discovered', async () => {
    const error = await runFail(
      buildResolverList(
        makeConfigStub({ order: ['plugin:missing'] }),
        secrets,
        url,
        defaultResolvers,
        [],
      ),
    );

    expect(error._tag).toBe('ConfigError');
    expect(String(error.cause)).toContain('missing');
  });

  it('reports a clear config error when plugins are disabled for a plugin token', async () => {
    const error = await runFail(
      buildResolverList(
        makeConfigStub({ order: ['plugin:alpha'] }),
        secrets,
        url,
        defaultResolvers,
        [],
      ),
    );

    expect(error.message).toBe(
      'Unknown or undiscovered plugin "alpha" in order',
    );
  });

  it('keeps the first occurrence when tokens duplicate a resolver', async () => {
    const result = await Effect.runPromise(
      buildResolverList(
        makeConfigStub({
          order: ['default:jina', 'default:jina', 'default:*', 'default:raw'],
        }),
        secrets,
        url,
        defaultResolvers,
        [],
      ),
    );

    expect(result.map((resolver) => resolver.id)).toEqual([
      'jina',
      'raw',
      'direct',
      'md-suffix',
    ]);
  });

  it('keeps a plugin and built-in with the same name in separate namespaces', async () => {
    const result = await Effect.runPromise(
      buildResolverList(
        makeConfigStub({ order: ['plugin:jina', 'default:jina'] }),
        secrets,
        url,
        defaultResolvers,
        [makePlugin('jina')],
      ),
    );

    expect(
      result.map((resolver) => `${resolver.isDefault}:${resolver.id}`),
    ).toEqual(['false:jina', 'true:jina']);
  });

  it('passes plain plugin config to the manifest resolver', async () => {
    let receivedConfig: Record<string, unknown> | undefined;
    const plugin = makePlugin('alpha');
    plugin.manifest.resolve = (context) => {
      receivedConfig = context.config;
      return { markdown: '# alpha' };
    };
    const config = makeConfigStub({
      order: ['plugin:alpha'],
      plugins: { alpha: { mode: 'full' } },
    });
    const resolver = await Effect.runPromise(
      buildResolverList(config, secrets, url, [], [plugin]),
    );

    const firstResolver = resolver[0];
    if (firstResolver === undefined) {
      throw new Error('expected a plugin resolver');
    }
    const outcome = await Effect.runPromise(firstResolver.run(url));

    expect(outcome._tag).toBe('success');
    expect(receivedConfig).toEqual({ mode: 'full' });
  });

  it('ranks path specificity for plugin metadata', () => {
    const broad = makePlugin('broad');
    const narrow = makePlugin('narrow', {
      hostname: 'x.com',
      path: '/*/status/*',
    });

    expect(computeSpecificity(narrow.manifest.match)).toBeGreaterThan(
      computeSpecificity(broad.manifest.match),
    );
  });

  it('adapts a plugin resolver with no configured args to an empty config object', async () => {
    const plugin = makePlugin('alpha');
    let receivedConfig: Record<string, unknown> | undefined;
    plugin.manifest.resolve = (context) => {
      receivedConfig = context.config;
      return null;
    };

    const resolver = toPluginResolver(secrets, makeConfigStub(), plugin);
    await Effect.runPromise(resolver.run(url));

    expect(receivedConfig).toEqual({});
  });
});
