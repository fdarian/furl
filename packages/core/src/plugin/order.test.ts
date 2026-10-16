import { describe, expect, it } from 'bun:test';
import { Effect, Option } from 'effect';

import type {
  FurlConfigServiceShape,
  PluginConfigValue,
} from '../config-service.ts';
import { ConfigError, describeCause, ResolverError } from '../errors.ts';
import type { DiscoveredPlugin } from './discovery.ts';
import { runResolvers } from './engine.ts';
import {
  buildResolverList,
  hasPluginToken,
  insertPluginToken,
  insertProviderToken,
  matchesUrl,
  parseOrderToken,
  parseOrderTokens,
  removeProviderToken,
  toPluginResolver,
} from './order.ts';
import type { Resolver } from './resolver.ts';
import { makeSecretsStub } from './test-doubles.ts';
import { ResolveDecline, ResolveSuccess } from './types.ts';

const runFail = <A, E>(effect: Effect.Effect<A, E>): Promise<E> =>
  Effect.runPromise(Effect.flip(effect));

const makeConfigStub = (
  options: {
    order?: readonly string[];
    plugins?: Readonly<Record<string, PluginConfigValue>>;
  } = {},
): FurlConfigServiceShape => ({
  read: Effect.succeed({ order: options.order, plugins: options.plugins }),
  resolveProvider: Effect.succeed(Option.some('jina')),
  resolveOrder: Effect.succeed(options.order ?? ['default:*']),
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

describe('insertProviderToken', () => {
  it('starts a missing order with the keyless wildcard before the provider', () => {
    expect(insertProviderToken(['default:*'], 'exa')).toEqual([
      'default:*',
      'default:exa',
    ]);
  });

  it('moves an existing provider ahead of other providers without duplicating it', () => {
    expect(
      insertProviderToken(['default:*', 'default:jina', 'default:exa'], 'exa'),
    ).toEqual(['default:*', 'default:exa', 'default:jina']);
  });

  it('preserves unrelated order entries while inserting after free probes', () => {
    expect(
      insertProviderToken(['default:*', 'plugin:alpha'], 'firecrawl'),
    ).toEqual(['default:*', 'default:firecrawl', 'plugin:alpha']);
  });
});

describe('insertPluginToken', () => {
  it('puts a new plugin before the current effective order', () => {
    expect(insertPluginToken(['default:*', 'default:jina'], 'alpha')).toEqual([
      'plugin:alpha',
      'default:*',
      'default:jina',
    ]);
  });

  it('moves an existing plugin token to the front without duplicating it', () => {
    expect(
      insertPluginToken(
        ['default:*', 'plugin:alpha', 'default:jina', 'plugin:alpha'],
        'alpha',
      ),
    ).toEqual(['plugin:alpha', 'default:*', 'default:jina']);
  });
});

describe('removeProviderToken', () => {
  it('removes only the given provider token', () => {
    expect(
      removeProviderToken(
        ['default:*', 'default:exa', 'plugin:alpha', 'default:firecrawl'],
        'exa',
      ),
    ).toEqual(['default:*', 'plugin:alpha', 'default:firecrawl']);
  });

  it('never adds jina when the removed provider was the last one', () => {
    expect(removeProviderToken(['default:*', 'default:exa'], 'exa')).toEqual([
      'default:*',
    ]);
  });

  it('leaves an order without the token unchanged', () => {
    expect(removeProviderToken(['default:*'], 'exa')).toEqual(['default:*']);
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

describe('parseOrderTokens', () => {
  it('parses every token in order', async () => {
    const tokens = await Effect.runPromise(
      parseOrderTokens(['plugin:alpha', 'default:*', 'default:jina']),
    );

    expect(tokens).toEqual([
      { _tag: 'plugin', name: 'alpha' },
      { _tag: 'default-wildcard' },
      { _tag: 'default', name: 'jina' },
    ]);
  });

  it('fails on the first invalid token', async () => {
    const error = await runFail(parseOrderTokens(['default:*', 'bogus']));

    expect(error._tag).toBe('ConfigError');
    expect(error.message).toContain('Invalid order token "bogus"');
  });

  it('detects plugin tokens only when one is present', async () => {
    const withPlugin = await Effect.runPromise(
      parseOrderTokens(['default:raw', 'plugin:alpha']),
    );
    const withoutPlugin = await Effect.runPromise(
      parseOrderTokens(['default:*', 'default:jina']),
    );

    expect(hasPluginToken(withPlugin)).toBe(true);
    expect(hasPluginToken(withoutPlugin)).toBe(false);
  });
});

describe('buildResolverList', () => {
  const url = new URL('https://x.com/someone/status/123');
  const secrets = makeSecretsStub();
  const defaultResolvers = makeDefaultResolvers();

  const build = (
    config: FurlConfigServiceShape,
    order: readonly string[],
    options: {
      defaults?: readonly Resolver[];
      plugins?: readonly DiscoveredPlugin[];
      secrets?: ReturnType<typeof makeSecretsStub>;
    } = {},
  ) =>
    Effect.gen(function* () {
      const parsedTokens = yield* parseOrderTokens(order);
      return yield* buildResolverList(
        config,
        options.secrets ?? secrets,
        url,
        options.defaults ?? defaultResolvers,
        options.plugins ?? [],
        parsedTokens,
      );
    });

  const onlyResolver = (resolvers: readonly Resolver[]): Resolver => {
    const resolver = resolvers[0];
    if (resolver === undefined) {
      throw new Error('expected a resolver');
    }
    return resolver;
  };

  it('expands default:* to raw, direct, and md-suffix only', async () => {
    const result = await Effect.runPromise(
      build(makeConfigStub(), ['default:*']),
    );

    expect(result.map((resolver) => resolver.id)).toEqual([
      'raw',
      'direct',
      'md-suffix',
    ]);
  });

  it('rejects an empty order', async () => {
    const error = await runFail(build(makeConfigStub(), []));

    expect(error._tag).toBe('ConfigError');
    expect(error.message).toBe('order must contain at least one token');
  });

  it('runs a discovered plugin only when plugin:<name> is listed', async () => {
    const plugin = makePlugin('alpha');
    const discovered = await Effect.runPromise(
      build(makeConfigStub(), ['default:*'], { plugins: [plugin] }),
    );
    const listed = await Effect.runPromise(
      build(makeConfigStub(), ['plugin:alpha'], { plugins: [plugin] }),
    );

    expect(discovered.map((resolver) => resolver.id)).not.toContain('alpha');
    expect(listed.map((resolver) => resolver.id)).toEqual(['alpha']);
  });

  it('rejects a plugin token when the plugin was not discovered', async () => {
    const error = await runFail(build(makeConfigStub(), ['plugin:missing']));

    expect(error._tag).toBe('ConfigError');
    expect(error.message).toContain('missing');
  });

  it('keeps the first occurrence when tokens duplicate a resolver', async () => {
    const result = await Effect.runPromise(
      build(makeConfigStub(), [
        'default:jina',
        'default:jina',
        'default:*',
        'default:raw',
      ]),
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
      build(makeConfigStub(), ['plugin:jina', 'default:jina'], {
        plugins: [makePlugin('jina')],
      }),
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
      plugins: { alpha: { mode: 'full' } },
    });

    const resolvers = await Effect.runPromise(
      build(config, ['plugin:alpha'], { defaults: [], plugins: [plugin] }),
    );
    const outcome = await Effect.runPromise(onlyResolver(resolvers).run(url));

    expect(outcome._tag).toBe('success');
    expect(receivedConfig).toEqual({ mode: 'full' });
  });

  it('reads the config once for every plugin, and not at all without plugin tokens', async () => {
    let reads = 0;
    const config: FurlConfigServiceShape = {
      ...makeConfigStub({ plugins: { alpha: { a: 1 }, beta: { b: 2 } } }),
      read: Effect.sync(() => {
        reads += 1;
        return { plugins: { alpha: { a: 1 }, beta: { b: 2 } } };
      }),
    };

    await Effect.runPromise(
      build(config, ['plugin:alpha', 'plugin:beta'], {
        plugins: [makePlugin('alpha'), makePlugin('beta')],
      }),
    );
    expect(reads).toBe(1);

    await Effect.runPromise(build(config, ['default:*']));
    expect(reads).toBe(1);
  });

  it('fails the build when the config cannot be read', async () => {
    const config: FurlConfigServiceShape = {
      ...makeConfigStub(),
      read: Effect.fail(new ConfigError({ cause: new Error('corrupt') })),
    };

    const error = await runFail(
      build(config, ['plugin:alpha'], { plugins: [makePlugin('alpha')] }),
    );

    expect(error._tag).toBe('ConfigError');
    expect(error.message).toBe('corrupt');
  });

  it('adapts a plugin resolver with no configured args to an empty config object', async () => {
    const plugin = makePlugin('alpha');
    let receivedConfig: Record<string, unknown> | undefined;
    plugin.manifest.resolve = (context) => {
      receivedConfig = context.config;
      return null;
    };

    const resolver = toPluginResolver(secrets, plugin, undefined);
    await Effect.runPromise(resolver.run(url));

    expect(receivedConfig).toEqual({});
  });

  it('resolves "secret:<name>" config refs before invoking the plugin', async () => {
    const plugin = makePlugin('alpha');
    let receivedConfig: Record<string, unknown> | undefined;
    plugin.manifest.resolve = (context) => {
      receivedConfig = context.config;
      return null;
    };

    const resolver = toPluginResolver(
      makeSecretsStub({ 'secret/alpha.apiKey': 'real-key' }),
      plugin,
      { apiKey: 'secret:alpha.apiKey', mode: 'full' },
    );
    await Effect.runPromise(resolver.run(url));

    expect(receivedConfig).toEqual({ apiKey: 'real-key', mode: 'full' });
  });

  it('fails with a ConfigError without running the plugin when a referenced secret is missing', async () => {
    const plugin = makePlugin('alpha');
    let invoked = false;
    plugin.manifest.resolve = () => {
      invoked = true;
      return null;
    };

    const resolver = toPluginResolver(makeSecretsStub(), plugin, {
      apiKey: 'secret:alpha.apiKey',
    });
    const error = await runFail(resolver.run(url));

    expect(error._tag).toBe('ConfigError');
    expect(invoked).toBe(false);
  });

  it('aborts the chain when a plugin secret is missing instead of trying the next resolver', async () => {
    const plugin = makePlugin('alpha');
    const resolvers = await Effect.runPromise(
      build(
        makeConfigStub({
          plugins: { alpha: { apiKey: 'secret:alpha.apiKey' } },
        }),
        ['plugin:alpha', 'default:*'],
        { plugins: [plugin] },
      ),
    );

    const error = await runFail(runResolvers(url, resolvers));

    expect(error._tag).toBe('ConfigError');
  });
});

describe('plugin resolve results', () => {
  const url = new URL('https://x.com/a');

  const runPlugin = (result: unknown) => {
    const plugin = makePlugin('alpha');
    plugin.manifest.resolve = () =>
      result as ReturnType<DiscoveredPlugin['manifest']['resolve']>;
    return toPluginResolver(makeSecretsStub(), plugin, undefined).run(url);
  };

  it('treats null and undefined as a decline', async () => {
    expect(await Effect.runPromise(runPlugin(null))).toEqual(
      new ResolveDecline(),
    );
    expect(await Effect.runPromise(runPlugin(undefined))).toEqual(
      new ResolveDecline(),
    );
  });

  it('treats { markdown: string } as success, including an empty string', async () => {
    expect(await Effect.runPromise(runPlugin({ markdown: '# hi' }))).toEqual(
      new ResolveSuccess({ markdown: '# hi' }),
    );
    expect(await Effect.runPromise(runPlugin({ markdown: '' }))).toEqual(
      new ResolveSuccess({ markdown: '' }),
    );
  });

  it.each([
    ['a bare string', '# hi'],
    ['a number', 42],
    ['an array', []],
    ['an object without markdown', { text: '# hi' }],
    ['an object with a non-string markdown', { markdown: 1 }],
  ])('fails with a ResolverError for %s', async (_label, value) => {
    const error = await runFail(runPlugin(value));

    expect(error._tag).toBe('ResolverError');
    if (!(error instanceof ResolverError)) {
      throw new Error(`expected ResolverError, got ${error._tag}`);
    }
    expect(error.id).toBe('alpha');
    expect(describeCause(error.cause)).toContain('{ markdown: string }');
  });

  it('records a malformed result and lets the chain continue', async () => {
    const plugin = makePlugin('alpha');
    plugin.manifest.resolve = () =>
      'oops' as unknown as ReturnType<DiscoveredPlugin['manifest']['resolve']>;
    const fallback: Resolver = {
      id: 'fallback',
      isDefault: false,
      match: null,
      run: () => Effect.succeed(new ResolveSuccess({ markdown: '# next' })),
    };

    const result = await Effect.runPromise(
      runResolvers(url, [
        toPluginResolver(makeSecretsStub(), plugin, undefined),
        fallback,
      ]),
    );

    expect(result.source).toBe('plugin:fallback');
  });
});
