import { describe, expect, it, spyOn } from 'bun:test';
import { Effect } from 'effect';

import type { DiscoveredPlugin } from './discovery.ts';
import {
  buildResolverList,
  filterEnabledPlugins,
  matchesUrl,
  parseOrderToken,
} from './order.ts';
import { computeSpecificity } from './resolver.ts';
import {
  makeConfigStub,
  makeResolverStub,
  makeSecretsStub,
} from './test-doubles.ts';

const runFail = <A, E>(effect: Effect.Effect<A, E>): Promise<E> =>
  Effect.runPromise(Effect.flip(effect));

const makePlugin = (
  name: string,
  match: DiscoveredPlugin['manifest']['match'],
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

describe('parseOrderToken', () => {
  it('parses "*" as the wildcard token', async () => {
    const token = await Effect.runPromise(parseOrderToken('*'));
    expect(token).toEqual({ _tag: 'wildcard' });
  });

  it('parses "default:*" as the default-wildcard token', async () => {
    const token = await Effect.runPromise(parseOrderToken('default:*'));
    expect(token).toEqual({ _tag: 'default-wildcard' });
  });

  it('parses "default:<name>" for a known built-in name', async () => {
    const token = await Effect.runPromise(parseOrderToken('default:jina'));
    expect(token).toEqual({ _tag: 'default', name: 'jina' });
  });

  it('rejects "default:<name>" for an unknown built-in name', async () => {
    const error = await runFail(parseOrderToken('default:bogus'));
    expect(error._tag).toBe('ConfigError');
    expect(String(error.cause)).toContain('bogus');
  });

  it('parses a bare token as a plugin id', async () => {
    const token = await Effect.runPromise(parseOrderToken('x'));
    expect(token).toEqual({ _tag: 'id', id: 'x' });
  });
});

describe('matchesUrl', () => {
  const url = new URL('https://x.com/someone/status/123');

  it('matches any URL when the pattern is null', () => {
    expect(matchesUrl(null, url)).toBe(true);
  });

  it('rejects a different hostname', () => {
    expect(matchesUrl({ hostname: 'other.com' }, url)).toBe(false);
  });

  it('matches on hostname alone when no path is given', () => {
    expect(matchesUrl({ hostname: 'x.com' }, url)).toBe(true);
  });

  it('matches a path pattern with "*" segments', () => {
    expect(matchesUrl({ hostname: 'x.com', path: '/*/status/*' }, url)).toBe(
      true,
    );
  });

  it('rejects a path pattern with a different segment count', () => {
    expect(matchesUrl({ hostname: 'x.com', path: '/*/status' }, url)).toBe(
      false,
    );
  });

  it('rejects a path pattern whose literal segment does not match', () => {
    expect(matchesUrl({ hostname: 'x.com', path: '/*/replies/*' }, url)).toBe(
      false,
    );
  });
});

describe('buildResolverList', () => {
  const url = new URL('https://x.com/someone/status/123');
  const secrets = makeSecretsStub();

  const defaultResolvers = [
    makeResolverStub({ id: 'raw', isDefault: true }),
    makeResolverStub({ id: 'direct', isDefault: true }),
    makeResolverStub({ id: 'md-suffix', isDefault: true }),
    makeResolverStub({ id: 'jina', isDefault: true }),
    makeResolverStub({ id: 'exa', isDefault: true }),
    makeResolverStub({ id: 'firecrawl', isDefault: true }),
  ];

  it('"*" expands to enabled, matching plugins sorted by specificity (narrowest first)', async () => {
    const broad = makePlugin('broad', { hostname: 'x.com' });
    const narrow = makePlugin('narrow', {
      hostname: 'x.com',
      path: '/*/status/*',
    });
    const config = makeConfigStub({ order: ['*'] });

    const result = await Effect.runPromise(
      buildResolverList(config, secrets, url, [], [broad, narrow]),
    );

    expect(result.map((resolver) => resolver.id)).toEqual(['narrow', 'broad']);
    expect(computeSpecificity(narrow.manifest.match)).toBeGreaterThan(
      computeSpecificity(broad.manifest.match),
    );
  });

  it('"*" excludes plugins that do not match the URL', async () => {
    const other = makePlugin('other', { hostname: 'example.com' });
    const config = makeConfigStub({ order: ['*'] });

    const result = await Effect.runPromise(
      buildResolverList(config, secrets, url, [], [other]),
    );

    expect(result).toEqual([]);
  });

  it('"default:*" expands to built-ins not named elsewhere, in canonical order', async () => {
    const config = makeConfigStub({ order: ['default:jina', 'default:*'] });

    const result = await Effect.runPromise(
      buildResolverList(config, secrets, url, defaultResolvers, []),
    );

    expect(result.map((resolver) => resolver.id)).toEqual([
      'jina',
      'raw',
      'direct',
      'md-suffix',
      'exa',
      'firecrawl',
    ]);
  });

  it('the default order excludes the API-key-backed builtins (jina/exa/firecrawl)', async () => {
    const config = makeConfigStub({
      order: ['*', 'default:raw', 'default:direct', 'default:md-suffix'],
    });

    const result = await Effect.runPromise(
      buildResolverList(config, secrets, url, defaultResolvers, []),
    );

    expect(result.map((resolver) => resolver.id)).toEqual([
      'raw',
      'direct',
      'md-suffix',
    ]);
  });

  it('an explicit "default:*" still expands to all six built-ins, in canonical order', async () => {
    const config = makeConfigStub({ order: ['default:*'] });

    const result = await Effect.runPromise(
      buildResolverList(config, secrets, url, defaultResolvers, []),
    );

    expect(result.map((resolver) => resolver.id)).toEqual([
      'raw',
      'direct',
      'md-suffix',
      'jina',
      'exa',
      'firecrawl',
    ]);
  });

  it('skips a plugin disabled via config even when named explicitly', async () => {
    const plugin = makePlugin('x', { hostname: 'x.com' });
    const config = makeConfigStub({
      order: ['x', '*', 'default:*'],
      plugins: { x: false },
    });

    const result = await Effect.runPromise(
      buildResolverList(config, secrets, url, defaultResolvers, [plugin]),
    );

    expect(result.map((resolver) => resolver.id)).not.toContain('x');
  });

  it('an explicitly-named id is not duplicated by a later "*"/"default:*" expansion', async () => {
    const plugin = makePlugin('x', { hostname: 'x.com' });
    const config = makeConfigStub({ order: ['x', '*', 'default:*'] });

    const result = await Effect.runPromise(
      buildResolverList(config, secrets, url, defaultResolvers, [plugin]),
    );

    expect(result.filter((resolver) => resolver.id === 'x')).toHaveLength(1);
    expect(result[0]?.id).toBe('x');
  });

  it('fails with ConfigError when the order contains an unknown default resolver name', async () => {
    const config = makeConfigStub({ order: ['default:bogus'] });

    const error = await runFail(
      buildResolverList(config, secrets, url, defaultResolvers, []),
    );

    expect(error._tag).toBe('ConfigError');
  });

  it("a plugin sharing a built-in's name coexists with it instead of shadowing it", async () => {
    const plugin = makePlugin('jina', { hostname: 'x.com' });
    const config = makeConfigStub({ order: ['*', 'default:*'] });

    const result = await Effect.runPromise(
      buildResolverList(config, secrets, url, defaultResolvers, [plugin]),
    );

    const jinaEntries = result.filter((resolver) => resolver.id === 'jina');
    expect(jinaEntries.map((resolver) => resolver.isDefault).sort()).toEqual([
      false,
      true,
    ]);
  });

  it('a bare id naming an uninstalled plugin does not suppress the same-named built-in', async () => {
    const config = makeConfigStub({ order: ['jina', 'default:*'] });
    const spy = spyOn(console, 'error').mockImplementation(() => {});

    const result = await Effect.runPromise(
      buildResolverList(config, secrets, url, defaultResolvers, []),
    );

    expect(result.map((resolver) => resolver.id)).toContain('jina');
    expect(result.filter((resolver) => resolver.id === 'jina')).toHaveLength(1);
    spy.mockRestore();
  });

  it('warns once on an order id token matching no installed plugin and no built-in', async () => {
    const config = makeConfigStub({
      order: ['typo-plugin', '*', 'default:*'],
    });
    const spy = spyOn(console, 'error').mockImplementation(() => {});

    await Effect.runPromise(
      buildResolverList(config, secrets, url, defaultResolvers, []),
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain('typo-plugin');
    spy.mockRestore();
  });

  it('does not warn on a bare id token that merely coincides with a built-in name', async () => {
    const config = makeConfigStub({ order: ['jina', 'default:*'] });
    const spy = spyOn(console, 'error').mockImplementation(() => {});

    await Effect.runPromise(
      buildResolverList(config, secrets, url, defaultResolvers, []),
    );

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not warn on a bare id token naming a plugin that is merely disabled', async () => {
    const plugin = makePlugin('x', { hostname: 'x.com' });
    const config = makeConfigStub({
      order: ['x', '*', 'default:*'],
      plugins: { x: false },
    });
    const spy = spyOn(console, 'error').mockImplementation(() => {});

    await Effect.runPromise(
      buildResolverList(config, secrets, url, defaultResolvers, [plugin]),
    );

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('filterEnabledPlugins', () => {
  it('drops a plugin disabled via config', async () => {
    const enabled = makePlugin('enabled-plugin', { hostname: 'x.com' });
    const disabled = makePlugin('disabled-plugin', { hostname: 'x.com' });
    const config = makeConfigStub({ plugins: { 'disabled-plugin': false } });

    const result = await Effect.runPromise(
      filterEnabledPlugins(config, [enabled, disabled]),
    );

    expect(result.map((plugin) => plugin.manifest.name)).toEqual([
      'enabled-plugin',
    ]);
  });

  it('keeps every plugin when none are disabled', async () => {
    const first = makePlugin('a', { hostname: 'x.com' });
    const second = makePlugin('b', { hostname: 'x.com' });
    const config = makeConfigStub();

    const result = await Effect.runPromise(
      filterEnabledPlugins(config, [first, second]),
    );

    expect(result.map((plugin) => plugin.manifest.name)).toEqual(['a', 'b']);
  });
});
