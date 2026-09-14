import { Context, Effect, Layer } from 'effect';
import { HttpClient } from 'effect/unstable/http';

import type { FurlConfig, FurlConfigServiceShape } from './config-service.ts';
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
  /** Force one order token for this call, without changing config.json. */
  pluginToken?: string;
  /** Preserve the legacy `--provider` behavior for this call. */
  forcedProvider?: ProviderName;
  /** Compatibility input for callers that used the pre-order resolver id option. */
  forcedResolverId?: string;
  /** Skip plugin discovery for this call. */
  pluginsDisabled?: boolean;
};

export type FurlError =
  | AllResolversFailed
  | ConfigError
  | FetchError
  | PluginLoadError
  | ResolverError;

type HttpClientService = Context.Service.Shape<typeof HttpClient.HttpClient>;
type PluginDiscoveryService = Context.Service.Shape<typeof PluginDiscovery>;

const legacyOrder = (provider: ProviderName): readonly string[] => [
  'default:raw',
  'default:direct',
  'default:md-suffix',
  `default:${provider}`,
];

const resolverTokenFromLegacyId = (id: string): string => {
  if (id.startsWith('default:') || id.startsWith('plugin:')) {
    return id;
  }

  return `plugin:${id}`;
};

const isPluginToken = (token: string): boolean => token.startsWith('plugin:');

const effectiveOrder = (
  config: FurlConfig,
  options: FetchOptions,
): readonly string[] => {
  if (options.pluginToken !== undefined) {
    return [options.pluginToken];
  }

  if (options.forcedResolverId !== undefined) {
    return [resolverTokenFromLegacyId(options.forcedResolverId)];
  }

  if (options.forcedProvider !== undefined) {
    return legacyOrder(options.forcedProvider);
  }

  if (config.order !== undefined) {
    return config.order;
  }

  return legacyOrder(config.provider ?? 'jina');
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

    const configValue = yield* config.read;
    const defaultResolvers = createDefaultResolvers(client, secrets);
    const order = effectiveOrder(configValue, options);
    const requiresPluginDiscovery = order.some(isPluginToken);
    const discoveredPlugins =
      options.pluginsDisabled === true ||
      (options.forcedProvider !== undefined && !requiresPluginDiscovery)
        ? []
        : yield* discovery.discover;
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
          forcedProvider: provider,
        }),
    };
  }),
).pipe(
  Layer.provide(PluginDiscovery.layer.pipe(Layer.provide(PluginLoader.layer))),
  Layer.provide(SecretsLive),
  Layer.provide(FurlConfigServiceLive),
);
