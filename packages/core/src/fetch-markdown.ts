import { Context, Effect, Layer } from 'effect';
import { HttpClient } from 'effect/unstable/http';

import type { FurlConfigServiceShape } from './config-service.ts';
import { FurlConfigService, FurlConfigServiceLive } from './config-service.ts';
import type {
  AllResolversFailed,
  ConfigError,
  PluginLoadError,
  ResolverError,
} from './errors.ts';
import { FetchError } from './errors.ts';
import { createDefaultResolvers } from './plugin/default/index.ts';
import { PluginDiscovery } from './plugin/discovery.ts';
import { runResolvers } from './plugin/engine.ts';
import { PluginLoader } from './plugin/loader.ts';
import { buildResolverList } from './plugin/order.ts';
import type { ProviderName } from './provider-name.ts';
import type { SecretsService } from './secrets-service.ts';
import { Secrets, SecretsLive } from './secrets-service.ts';

export type FetchResult = {
  markdown: string;
  source: string;
};

export type FetchOptions = {
  /** Override the configured resolver order for this call. */
  resolvers?: readonly string[];
};

export type FurlError =
  | AllResolversFailed
  | ConfigError
  | FetchError
  | PluginLoadError
  | ResolverError;

type HttpClientService = Context.Service.Shape<typeof HttpClient.HttpClient>;
type PluginDiscoveryService = Context.Service.Shape<typeof PluginDiscovery>;

const isPluginToken = (token: string): boolean => token.startsWith('plugin:');

export const shouldDiscoverPlugins = (order: readonly string[]): boolean =>
  order.some(isPluginToken);

const effectiveOrder = (
  config: FurlConfigServiceShape,
  options: FetchOptions,
): Effect.Effect<readonly string[], ConfigError> => {
  return options.resolvers === undefined
    ? config.resolveOrder
    : Effect.succeed(options.resolvers);
};

const fetchMarkdown = (
  client: HttpClientService,
  config: FurlConfigServiceShape,
  secrets: SecretsService,
  discovery: PluginDiscoveryService,
  url: string,
  options: FetchOptions,
): Effect.Effect<
  FetchResult,
  | ConfigError
  | FetchError
  | PluginLoadError
  | AllResolversFailed
  | ResolverError
> =>
  Effect.gen(function* () {
    const parsedUrl = yield* Effect.try({
      try: () => new URL(url),
      catch: (cause) =>
        new FetchError({ url: url, status: undefined, cause: cause }),
    });

    const defaultResolvers = createDefaultResolvers(client, secrets);
    const order = yield* effectiveOrder(config, options);
    const discoveredPlugins = shouldDiscoverPlugins(order)
      ? yield* discovery.discover
      : [];
    const resolverList = yield* buildResolverList(
      config,
      secrets,
      parsedUrl,
      defaultResolvers,
      discoveredPlugins,
      order,
    );

    return yield* runResolvers(parsedUrl, resolverList);
  });

export class Furl extends Context.Service<
  Furl,
  {
    fetch: (
      url: string,
      options?: FetchOptions,
    ) => Effect.Effect<FetchResult, FurlError>;
    fetchWithProvider: (
      url: string,
      provider: ProviderName,
    ) => Effect.Effect<FetchResult, FurlError>;
  }
>()('furl/core') {}

export const FurlLive = Layer.effect(
  Furl,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const config = yield* FurlConfigService;
    const secrets = yield* Secrets;
    const discovery = yield* PluginDiscovery;

    return {
      fetch: (url: string, options?: FetchOptions) =>
        fetchMarkdown(client, config, secrets, discovery, url, options ?? {}),
      fetchWithProvider: (url: string, provider: ProviderName) =>
        fetchMarkdown(client, config, secrets, discovery, url, {
          resolvers: ['default:*', `default:${provider}`],
        }),
    };
  }),
).pipe(
  Layer.provide(PluginDiscovery.layer.pipe(Layer.provide(PluginLoader.layer))),
  Layer.provide(SecretsLive),
  Layer.provide(FurlConfigServiceLive),
);
