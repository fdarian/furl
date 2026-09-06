import { Console, Effect } from 'effect';

import type { FurlConfigServiceShape } from '../config-service.ts';
import { ConfigError, ResolverError } from '../errors.ts';
import type { SecretsService } from '../secrets-service.ts';

import {
  type DefaultResolverName,
  defaultResolverNames,
} from './default/shared.ts';
import type { DiscoveredPlugin } from './discovery.ts';
import { resolvePluginConfig } from './resolve-config.ts';
import { computeSpecificity, type Resolver } from './resolver.ts';
import {
  type MatchPattern,
  ResolveDecline,
  type ResolveOutcome,
  ResolveSuccess,
} from './types.ts';

type OrderToken =
  | { _tag: 'id'; id: string }
  | { _tag: 'wildcard' }
  | { _tag: 'default'; name: DefaultResolverName }
  | { _tag: 'default-wildcard' };

const defaultResolverNameSet: ReadonlySet<string> = new Set(
  defaultResolverNames,
);

const defaultTokenPrefix = 'default:';

/**
 * Parses one `order` token: `<id>` | `*` | `default:<name>` | `default:*`.
 *
 * `<id>` always names a plugin, by its manifest name — never a built-in,
 * even if a built-in happens to share that name. The only way to name a
 * built-in is the `default:<name>` form. This keeps a bare token
 * unambiguous: a plugin installed as `jina` and the built-in `jina`
 * resolver can coexist, `order: ['jina', ...]` always means the plugin,
 * and `order: ['default:jina', ...]` always means the built-in.
 */
export const parseOrderToken = (
  token: string,
): Effect.Effect<OrderToken, ConfigError> => {
  if (token === '*') {
    return Effect.succeed({ _tag: 'wildcard' });
  }

  if (token === 'default:*') {
    return Effect.succeed({ _tag: 'default-wildcard' });
  }

  if (token.startsWith(defaultTokenPrefix)) {
    const name = token.slice(defaultTokenPrefix.length);

    if (!defaultResolverNameSet.has(name)) {
      return Effect.fail(
        new ConfigError({
          cause: new Error(
            `Unknown default resolver "${name}" in order (expected one of ${defaultResolverNames.join(', ')})`,
          ),
        }),
      );
    }

    return Effect.succeed({
      _tag: 'default',
      name: name as DefaultResolverName,
    });
  }

  return Effect.succeed({ _tag: 'id', id: token });
};

/** A pattern's path segments matched one-to-one against the URL's segments; `*` matches exactly one segment. */
const matchPathPattern = (pattern: string, pathname: string): boolean => {
  const patternSegments = pattern
    .split('/')
    .filter((segment) => segment.length > 0);
  const pathSegments = pathname
    .split('/')
    .filter((segment) => segment.length > 0);

  if (patternSegments.length !== pathSegments.length) {
    return false;
  }

  return patternSegments.every(
    (patternSegment, index) =>
      patternSegment === '*' || patternSegment === pathSegments[index],
  );
};

export const matchesUrl = (match: MatchPattern | null, url: URL): boolean => {
  if (match === null) {
    return true;
  }

  if (match.hostname !== url.hostname) {
    return false;
  }

  if (match.path === undefined) {
    return true;
  }

  return matchPathPattern(match.path, url.pathname);
};

/** Wraps a discovered plugin as a `Resolver`: resolves its config args, then maps decline/success/error. */
export const toPluginResolver = (
  secrets: SecretsService,
  configService: FurlConfigServiceShape,
  plugin: DiscoveredPlugin,
): Resolver => ({
  id: plugin.manifest.name,
  isDefault: false,
  match: plugin.manifest.match,
  specificity: computeSpecificity(plugin.manifest.match),
  run: (url) =>
    Effect.gen(function* () {
      const configuredArgs = yield* configService
        .pluginArgs(plugin.manifest.name)
        .pipe(
          Effect.mapError(
            (cause) =>
              new ResolverError({ id: plugin.manifest.name, cause: cause }),
          ),
        );
      const args =
        configuredArgs === undefined || configuredArgs === false
          ? undefined
          : configuredArgs;
      const resolvedConfig = yield* resolvePluginConfig(
        secrets,
        plugin.manifest.name,
        args,
      );

      const result = yield* Effect.tryPromise({
        try: () =>
          Promise.resolve(
            plugin.manifest.resolve({
              url: url,
              config: resolvedConfig,
              decline: () => null,
            }),
          ),
        catch: (cause) =>
          new ResolverError({ id: plugin.manifest.name, cause: cause }),
      });

      if (result === null) {
        return new ResolveDecline() satisfies ResolveOutcome;
      }

      return new ResolveSuccess({
        markdown: result.markdown,
      }) satisfies ResolveOutcome;
    }),
});

/**
 * Drops plugins disabled via config — used both by `buildResolverList`'s
 * `order`-driven chain and by a forced `--plugin`/`--provider` resolution,
 * so disabling a plugin always wins even when it's named explicitly.
 */
export const filterEnabledPlugins = (
  configService: FurlConfigServiceShape,
  discoveredPlugins: readonly DiscoveredPlugin[],
): Effect.Effect<DiscoveredPlugin[], ConfigError> =>
  Effect.filter(discoveredPlugins, (plugin) =>
    configService
      .isPluginDisabled(plugin.manifest.name)
      .pipe(Effect.map((disabled) => !disabled)),
  );

/**
 * Identifies a resolver across both namespaces a bare id could otherwise
 * collide on: a plugin and a built-in may legitimately share an `id`
 * string (see `parseOrderToken`), so bookkeeping keyed on the bare `id`
 * alone would treat them as the same entry and let one silently drop the
 * other.
 */
const resolverIdentity = (resolver: Resolver): string =>
  `${resolver.isDefault ? 'default' : 'plugin'}:${resolver.id}`;

/**
 * Expands the `order` token list into a concrete, URL-specific resolver
 * chain: disabled plugins are dropped even if named explicitly; resolvers
 * whose matcher doesn't match the URL never enter the list; `*`/`default:*`
 * pick up everything enabled and matching that wasn't named elsewhere.
 */
export const buildResolverList = (
  configService: FurlConfigServiceShape,
  secrets: SecretsService,
  url: URL,
  defaultResolvers: readonly Resolver[],
  discoveredPlugins: readonly DiscoveredPlugin[],
): Effect.Effect<Resolver[], ConfigError> =>
  Effect.gen(function* () {
    const orderTokens = yield* configService.resolveOrder;
    const parsedTokens = yield* Effect.forEach(orderTokens, parseOrderToken);

    const enabledPlugins = yield* filterEnabledPlugins(
      configService,
      discoveredPlugins,
    );

    const pluginResolvers = enabledPlugins.map((plugin) =>
      toPluginResolver(secrets, configService, plugin),
    );

    const matchingDefaultResolvers = defaultResolvers.filter((resolver) =>
      matchesUrl(resolver.match, url),
    );
    const matchingPluginResolvers = pluginResolvers.filter((resolver) =>
      matchesUrl(resolver.match, url),
    );

    const discoveredPluginNames = new Set(
      discoveredPlugins.map((plugin) => plugin.manifest.name),
    );

    // Named per-namespace, not in one shared set: an `id` token only ever
    // names a plugin and a `default` token only ever names a built-in (see
    // `parseOrderToken`), so a plugin and a same-named built-in must be
    // excluded from `*`/`default:*` independently of each other.
    const namedPluginIds = new Set<string>();
    const namedDefaultIds = new Set<string>();
    for (const token of parsedTokens) {
      if (token._tag === 'id') {
        namedPluginIds.add(token.id);
        if (
          !discoveredPluginNames.has(token.id) &&
          !defaultResolverNameSet.has(token.id)
        ) {
          yield* Console.error(
            `↳ order token "${token.id}" matches no installed plugin and no built-in resolver, ignoring`,
          );
        }
      }
      if (token._tag === 'default') {
        namedDefaultIds.add(token.name);
      }
    }

    const result: Resolver[] = [];
    const usedIds = new Set<string>();

    const pushResolver = (resolver: Resolver) => {
      const identity = resolverIdentity(resolver);
      if (usedIds.has(identity)) {
        return;
      }
      result.push(resolver);
      usedIds.add(identity);
    };

    for (const token of parsedTokens) {
      if (token._tag === 'id') {
        const resolver = matchingPluginResolvers.find(
          (candidate) => candidate.id === token.id,
        );
        if (resolver !== undefined) {
          pushResolver(resolver);
        }
        continue;
      }

      if (token._tag === 'default') {
        const resolver = matchingDefaultResolvers.find(
          (candidate) => candidate.id === token.name,
        );
        if (resolver !== undefined) {
          pushResolver(resolver);
        }
        continue;
      }

      if (token._tag === 'wildcard') {
        const remaining = matchingPluginResolvers
          .filter((resolver) => !namedPluginIds.has(resolver.id))
          .sort((a, b) => b.specificity - a.specificity);
        for (const resolver of remaining) {
          pushResolver(resolver);
        }
        continue;
      }

      const remaining = matchingDefaultResolvers.filter(
        (resolver) => !namedDefaultIds.has(resolver.id),
      );
      for (const resolver of remaining) {
        pushResolver(resolver);
      }
    }

    return result;
  });
