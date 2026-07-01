import { Effect } from 'effect';

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

/** Parses one `order` token: `<id>` | `*` | `default:<name>` | `default:*`. */
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

    const enabledPlugins = yield* Effect.filter(discoveredPlugins, (plugin) =>
      configService
        .isPluginDisabled(plugin.manifest.name)
        .pipe(Effect.map((disabled) => !disabled)),
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

    const namedIds = new Set<string>();
    for (const token of parsedTokens) {
      if (token._tag === 'id') {
        namedIds.add(token.id);
      }
      if (token._tag === 'default') {
        namedIds.add(token.name);
      }
    }

    const result: Resolver[] = [];
    const usedIds = new Set<string>();

    const pushResolver = (resolver: Resolver) => {
      if (usedIds.has(resolver.id)) {
        return;
      }
      result.push(resolver);
      usedIds.add(resolver.id);
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
          .filter((resolver) => !namedIds.has(resolver.id))
          .sort((a, b) => b.specificity - a.specificity);
        for (const resolver of remaining) {
          pushResolver(resolver);
        }
        continue;
      }

      const remaining = matchingDefaultResolvers.filter(
        (resolver) => !namedIds.has(resolver.id),
      );
      for (const resolver of remaining) {
        pushResolver(resolver);
      }
    }

    return result;
  });
