import { Effect } from 'effect';

import type { FurlConfigServiceShape } from '../config-service.ts';
import { ConfigError, ResolverError } from '../errors.ts';
import type { SecretsService } from '../secrets-service.ts';

import {
  type DefaultResolverName,
  defaultResolverNames,
  defaultWildcardResolverNames,
} from './default/shared.ts';
import type { DiscoveredPlugin } from './discovery.ts';
import { computeSpecificity, type Resolver } from './resolver.ts';
import {
  type MatchPattern,
  ResolveDecline,
  type ResolveOutcome,
  ResolveSuccess,
} from './types.ts';

type OrderToken =
  | { _tag: 'default-wildcard' }
  | { _tag: 'default'; name: DefaultResolverName }
  | { _tag: 'plugin'; name: string };

const defaultResolverNameSet: ReadonlySet<string> = new Set(
  defaultResolverNames,
);

const defaultTokenPrefix = 'default:';
const pluginTokenPrefix = 'plugin:';

const invalidTokenError = (token: string): ConfigError =>
  new ConfigError({
    cause: new Error(
      `Invalid order token "${token}" (expected "default:*", "default:<builtin-name>", or "plugin:<plugin-name>")`,
    ),
  });

export const parseOrderToken = (
  token: string,
): Effect.Effect<OrderToken, ConfigError> => {
  if (token === 'default:*') {
    return Effect.succeed({ _tag: 'default-wildcard' });
  }

  if (token.startsWith(defaultTokenPrefix)) {
    const name = token.slice(defaultTokenPrefix.length);

    if (!defaultResolverNameSet.has(name)) {
      return Effect.fail(
        new ConfigError({
          cause: new Error(
            `Unknown built-in resolver "${name}" in order (expected one of ${defaultResolverNames.join(', ')})`,
          ),
        }),
      );
    }

    return Effect.succeed({
      _tag: 'default',
      name: name as DefaultResolverName,
    });
  }

  if (token.startsWith(pluginTokenPrefix)) {
    const name = token.slice(pluginTokenPrefix.length);

    if (name.length === 0) {
      return Effect.fail(invalidTokenError(token));
    }

    return Effect.succeed({ _tag: 'plugin', name: name });
  }

  return Effect.fail(invalidTokenError(token));
};

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

export const toPluginResolver = (
  _secrets: SecretsService,
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
      const resolvedConfig = configuredArgs === undefined ? {} : configuredArgs;

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

const resolverIdentity = (resolver: Resolver): string =>
  `${resolver.isDefault ? 'default' : 'plugin'}:${resolver.id}`;

const orderConfigError = (message: string): ConfigError =>
  new ConfigError({ cause: new Error(message) });

export const buildResolverList = (
  configService: FurlConfigServiceShape,
  secrets: SecretsService,
  url: URL,
  defaultResolvers: readonly Resolver[],
  discoveredPlugins: readonly DiscoveredPlugin[],
  orderOverride?: readonly string[],
): Effect.Effect<Resolver[], ConfigError> =>
  Effect.gen(function* () {
    const orderTokens =
      orderOverride === undefined
        ? yield* configService.resolveOrder
        : orderOverride;
    const parsedTokens = yield* Effect.forEach(orderTokens, parseOrderToken);

    const pluginByName = new Map<string, DiscoveredPlugin>();
    for (const plugin of discoveredPlugins) {
      if (!pluginByName.has(plugin.manifest.name)) {
        pluginByName.set(plugin.manifest.name, plugin);
      }
    }

    const defaultByName = new Map<string, Resolver>();
    for (const resolver of defaultResolvers) {
      if (resolver.isDefault && !defaultByName.has(resolver.id)) {
        defaultByName.set(resolver.id, resolver);
      }
    }

    const resolverForDefault = (
      name: DefaultResolverName,
    ): Effect.Effect<Resolver | undefined, ConfigError> => {
      const resolver = defaultByName.get(name);
      if (resolver === undefined) {
        return Effect.fail(
          orderConfigError(`Built-in resolver "${name}" is unavailable`),
        );
      }
      return Effect.succeed(resolver);
    };

    const pluginResolvers = new Map<string, Resolver>();
    for (const parsedToken of parsedTokens) {
      if (parsedToken._tag !== 'plugin') {
        continue;
      }

      const plugin = pluginByName.get(parsedToken.name);
      if (plugin === undefined) {
        return yield* orderConfigError(
          `Unknown or undiscovered plugin "${parsedToken.name}" in order`,
        );
      }

      if (!pluginResolvers.has(parsedToken.name)) {
        pluginResolvers.set(
          parsedToken.name,
          toPluginResolver(secrets, configService, plugin),
        );
      }
    }

    const matchingPlugins = new Map<string, Resolver>();
    for (const entry of pluginResolvers) {
      if (matchesUrl(entry[1].match, url)) {
        matchingPlugins.set(entry[0], entry[1]);
      }
    }

    const result: Resolver[] = [];
    const usedResolvers = new Set<string>();
    const pushResolver = (resolver: Resolver): void => {
      const identity = resolverIdentity(resolver);
      if (usedResolvers.has(identity)) {
        return;
      }
      usedResolvers.add(identity);
      result.push(resolver);
    };

    for (const parsedToken of parsedTokens) {
      if (parsedToken._tag === 'plugin') {
        const resolver = matchingPlugins.get(parsedToken.name);
        if (resolver !== undefined) {
          pushResolver(resolver);
        }
        continue;
      }

      if (parsedToken._tag === 'default') {
        const resolver = yield* resolverForDefault(parsedToken.name);
        if (resolver !== undefined && matchesUrl(resolver.match, url)) {
          pushResolver(resolver);
        }
        continue;
      }

      for (const name of defaultWildcardResolverNames) {
        const resolver = yield* resolverForDefault(name);
        if (resolver !== undefined && matchesUrl(resolver.match, url)) {
          pushResolver(resolver);
        }
      }
    }

    return result;
  });
