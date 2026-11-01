import { Context, Effect, Layer } from 'effect';
import { HttpClient } from 'effect/http';

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
  /** Replaces the layer's resolvers for this call. */
  resolvers?: readonly Resolver[];
};

export type FurlError = AllResolversFailed | ConfigError | FetchError;

type LayerOptions = {
  /** Defaults to `Resolvers.defaults`. */
  resolvers?: readonly Resolver[];
};

export class Furl extends Context.Service<
  Furl,
  {
    fetch: (
      url: string,
      options?: FetchOptions,
    ) => Effect.Effect<FetchResult, FurlError>;
  }
>()('furl/core') {
  static readonly layer = (
    options: LayerOptions = {},
  ): Layer.Layer<Furl, never, HttpClient.HttpClient> =>
    Layer.effect(
      Furl,
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const layerResolvers = options.resolvers ?? Resolvers.defaults;

        return {
          fetch: (url: string, fetchOptions?: FetchOptions) =>
            Effect.gen(function* () {
              const parsedUrl = yield* Effect.try({
                try: () => new URL(url),
                catch: (cause) =>
                  new FetchError({ url: url, status: undefined, cause: cause }),
              });

              return yield* runResolvers(
                parsedUrl,
                fetchOptions?.resolvers ?? layerResolvers,
              ).pipe(Effect.provideService(HttpClient.HttpClient, client));
            }),
        };
      }),
    );

  static readonly fetch = (
    url: string,
    options?: FetchOptions,
  ): Effect.Effect<FetchResult, FurlError, Furl> =>
    Effect.gen(function* () {
      const furl = yield* Furl;
      return yield* furl.fetch(url, options);
    });
}
