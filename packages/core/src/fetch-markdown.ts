import { Context, Effect, Layer } from 'effect';
import { HttpClient } from 'effect/unstable/http';

import type { FurlConfigServiceShape } from './config-service.ts';
import { FurlConfigService, FurlConfigServiceLive } from './config-service.ts';
import type {
  AllResolversFailed,
  ConfigError,
  PluginLoadError,
} from './errors.ts';
import { FetchError } from './errors.ts';
import { createDefaultResolvers } from './plugin/default-resolvers.ts';
import {
  PluginDiscovery,
  PluginDiscoveryLive,
  type PluginDiscoveryShape,
} from './plugin/discovery.ts';
import { runResolvers } from './plugin/engine.ts';
import { PluginLoaderLive } from './plugin/loader.ts';
import { buildResolverList, toPluginResolver } from './plugin/order.ts';
import type { SecretsService } from './secrets-service.ts';
import { Secrets, SecretsLive } from './secrets-service.ts';

export type FetchResult = {
  markdown: string;
  source: string;
};

/** Options controlling which resolvers a single `Furl.fetch` call considers. */
export type FetchOptions = {
  /** Force a single resolver id (a plugin name or a `default:` built-in name), skipping the ordered chain. */
  forcedResolverId?: string;
  /** Skip plugin discovery entirely — run the built-in `default:` chain only. */
  pluginsDisabled?: boolean;
};

type HttpClientService = Context.Service.Shape<typeof HttpClient.HttpClient>;

const fetchMarkdown = (
  client: HttpClientService,
  config: FurlConfigServiceShape,
  secrets: SecretsService,
  discovery: PluginDiscoveryShape,
  url: string,
  options: FetchOptions,
): Effect.Effect<
  FetchResult,
  ConfigError | FetchError | PluginLoadError | AllResolversFailed
> =>
  Effect.gen(function* () {
    const parsedUrl = yield* Effect.try({
      try: () => new URL(url),
      catch: (cause) =>
        new FetchError({ url: url, status: undefined, cause: cause }),
    });

    const defaultResolvers = createDefaultResolvers(client, secrets);
    const discoveredPlugins = options.pluginsDisabled
      ? []
      : yield* discovery.discover;

    const resolverList =
      options.forcedResolverId === undefined
        ? yield* buildResolverList(
            config,
            secrets,
            parsedUrl,
            defaultResolvers,
            discoveredPlugins,
          )
        : [
            ...defaultResolvers,
            ...discoveredPlugins.map((plugin) =>
              toPluginResolver(secrets, config, plugin),
            ),
          ].filter((resolver) => resolver.id === options.forcedResolverId);

    return yield* runResolvers(parsedUrl, resolverList);
  });

export class Furl extends Context.Service<
  Furl,
  {
    fetch: (
      url: string,
      options?: FetchOptions,
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
    };
  }),
).pipe(
  Layer.provide(PluginDiscoveryLive.pipe(Layer.provide(PluginLoaderLive))),
  Layer.provide(SecretsLive),
  Layer.provide(FurlConfigServiceLive),
);

export type FurlError =
  | AllResolversFailed
  | ConfigError
  | FetchError
  | PluginLoadError;
