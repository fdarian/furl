import { Context, Effect, Layer, Option } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';

import { runResolvers } from './engine.ts';
import type { AllResolversFailed, ConfigError } from './errors.ts';
import { FetchError } from './errors.ts';
import type { Resolver } from './resolver.ts';
import { Resolvers } from './resolvers.ts';

export type FetchResult = {
  markdown: string;
  /** The `id` of the resolver that produced the markdown. */
  source: string;
};

export type FetchOptions = {
  /** Replaces the service's resolvers for this call. */
  resolvers?: readonly Resolver[];
};

export type FurlError = AllResolversFailed | ConfigError | FetchError;

type LayerOptions = {
  /** Defaults to `Resolvers.defaults`. */
  resolvers?: readonly Resolver[];
};

type FurlService = {
  fetch: (
    url: string,
    options?: FetchOptions,
  ) => Effect.Effect<FetchResult, FurlError>;
};

type ProvideClient = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
) => Effect.Effect<A, E>;

const provideGlobalFetchClient: ProvideClient = (effect) =>
  Effect.provide(effect, FetchHttpClient.layer);

const makeService = (
  defaultResolvers: readonly Resolver[],
  provideClient: ProvideClient,
): FurlService => ({
  fetch: (url, options) =>
    Effect.gen(function* () {
      const parsedUrl = yield* Effect.try({
        try: () => new URL(url),
        catch: (cause) =>
          new FetchError({ url: url, status: undefined, cause: cause }),
      });

      return yield* provideClient(
        runResolvers(parsedUrl, options?.resolvers ?? defaultResolvers),
      );
    }),
});

/**
 * Works without a layer: the default value runs `Resolvers.defaults` over the
 * global `fetch`. Provide `Furl.layer` only to change that.
 */
export class Furl extends Context.Reference<FurlService>('furl/core', {
  defaultValue: () => makeService(Resolvers.defaults, provideGlobalFetchClient),
}) {
  static readonly layer = (options: LayerOptions = {}): Layer.Layer<never> =>
    Layer.effect(
      Furl,
      Effect.gen(function* () {
        const client = yield* Effect.serviceOption(HttpClient.HttpClient);
        const provideClient: ProvideClient = Option.match(client, {
          onNone: () => provideGlobalFetchClient,
          onSome: (httpClient) => (effect) =>
            Effect.provideService(effect, HttpClient.HttpClient, httpClient),
        });

        return makeService(
          options.resolvers ?? Resolvers.defaults,
          provideClient,
        );
      }),
    );

  static readonly fetch = (
    url: string,
    options?: FetchOptions,
  ): Effect.Effect<FetchResult, FurlError> =>
    Effect.gen(function* () {
      const furl = yield* Furl;
      return yield* furl.fetch(url, options);
    });
}
