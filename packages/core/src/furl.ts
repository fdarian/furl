import { Context, Effect, Layer } from 'effect';
import type { HttpClient } from 'effect/http';

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

/** Holds the resolver list `Furl.fetch` runs; it works without a layer. */
export class Furl extends Context.Reference<readonly Resolver[]>('furl/core', {
  defaultValue: () => Resolvers.defaults,
}) {
  static readonly layer = (options: LayerOptions = {}): Layer.Layer<never> =>
    Layer.succeed(Furl, options.resolvers ?? Resolvers.defaults);

  /** Requests go through the `HttpClient` in the caller's context. */
  static readonly fetch = (
    url: string,
    options?: FetchOptions,
  ): Effect.Effect<FetchResult, FurlError, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const parsedUrl = yield* Effect.try({
        try: () => new URL(url),
        catch: (cause) =>
          new FetchError({ url: url, status: undefined, cause: cause }),
      });
      const resolvers = options?.resolvers ?? (yield* Furl);

      return yield* runResolvers(parsedUrl, resolvers);
    });
}
