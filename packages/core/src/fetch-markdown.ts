import { Context, Effect, Layer, Option } from 'effect';
import { HttpClient } from 'effect/unstable/http';

import type { FurlConfigServiceShape } from './config-service.ts';
import { FurlConfigService, FurlConfigServiceLive } from './config-service.ts';
import {
  AllResolversFailed,
  type ConfigError,
  FetchError,
  KeychainError,
  NoProviderKey,
  ProviderError,
  ResolverError,
} from './errors.ts';
import { createDefaultResolvers } from './plugin/default/index.ts';
import { type ResolutionResult, runResolvers } from './plugin/engine.ts';
import type { Resolver } from './plugin/resolver.ts';
import type { ProviderName } from './provider-name.ts';
import type { SecretsService } from './secrets-service.ts';
import { Secrets, SecretsLive } from './secrets-service.ts';

export type FetchResult = {
  markdown: string;
  source:
    | 'raw'
    | 'direct'
    | 'md-suffix'
    | 'provider:jina'
    | 'provider:exa'
    | 'provider:firecrawl';
};

export type FurlError =
  | AllResolversFailed
  | ConfigError
  | FetchError
  | KeychainError
  | NoProviderKey
  | ProviderError
  | ResolverError;

type HttpClientService = Context.Service.Shape<typeof HttpClient.HttpClient>;

const isProbeResolver = (resolver: Resolver): boolean =>
  resolver.id === 'raw' ||
  resolver.id === 'direct' ||
  resolver.id === 'md-suffix';

const unwrapResolverFailure = (
  error: ResolverError | AllResolversFailed,
): FurlError => {
  const cause =
    error instanceof ResolverError
      ? error.cause
      : error.failures.length === 1
        ? error.failures[0]?.cause
        : undefined;

  if (cause instanceof ResolverError || cause instanceof AllResolversFailed) {
    return unwrapResolverFailure(cause);
  }

  if (
    cause instanceof FetchError ||
    cause instanceof KeychainError ||
    cause instanceof NoProviderKey ||
    cause instanceof ProviderError
  ) {
    return cause;
  }

  return error;
};

const toFetchResult = (result: ResolutionResult): FetchResult => ({
  markdown: result.markdown,
  source: result.source as FetchResult['source'],
});

const fetchMarkdown = (
  client: HttpClientService,
  config: FurlConfigServiceShape,
  secrets: SecretsService,
  url: string,
  providerOverride: Option.Option<ProviderName>,
): Effect.Effect<FetchResult, FurlError> =>
  Effect.gen(function* () {
    const parsedUrl = yield* Effect.try({
      try: () => new URL(url),
      catch: (cause) =>
        new FetchError({ url: url, status: undefined, cause: cause }),
    });
    const defaultResolvers = createDefaultResolvers(client, secrets);
    const probeResolvers = defaultResolvers.filter(isProbeResolver);
    const probeResult = yield* runResolvers(parsedUrl, probeResolvers).pipe(
      Effect.map(Option.some),
      Effect.catchTag('AllResolversFailed', () =>
        Effect.succeed(Option.none<ResolutionResult>()),
      ),
      Effect.mapError(unwrapResolverFailure),
    );

    if (Option.isSome(probeResult)) {
      return toFetchResult(probeResult.value);
    }

    const provider = yield* config.resolveProvider(providerOverride);
    const providerResolver = defaultResolvers.find(
      (candidate) => candidate.id === provider,
    );
    if (providerResolver === undefined) {
      return yield* Effect.die(
        new Error(`No default resolver found for provider "${provider}"`),
      );
    }

    return yield* runResolvers(parsedUrl, [providerResolver]).pipe(
      Effect.map(toFetchResult),
      Effect.mapError(unwrapResolverFailure),
    );
  });

export class Furl extends Context.Service<
  Furl,
  {
    fetch: (url: string) => Effect.Effect<FetchResult, FurlError>;
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

    return {
      fetch: (url: string) =>
        fetchMarkdown(client, config, secrets, url, Option.none()),
      fetchWithProvider: (url: string, provider: ProviderName) =>
        fetchMarkdown(client, config, secrets, url, Option.some(provider)),
    };
  }),
).pipe(Layer.provide(SecretsLive), Layer.provide(FurlConfigServiceLive));
