import { Effect } from 'effect';
import {
  HttpClient,
  HttpClientError,
  HttpClientResponse,
} from 'effect/unstable/http';

import type {
  FurlConfigServiceShape,
  PluginConfigValue,
} from '../config-service.ts';
import type { SecretsService } from '../secrets-service.ts';

import { matchAnySpecificity, type Resolver } from './resolver.ts';
import type { ResolveOutcome } from './types.ts';

/**
 * Offline test doubles shared by the plugin package's unit tests. Nothing
 * here touches the network or the OS keychain/filesystem.
 */

/** A `SecretsService` backed by an in-memory map — never touches the OS keychain. */
export const makeSecretsStub = (
  initial: Readonly<Record<string, string>> = {},
): SecretsService => {
  const store = new Map(Object.entries(initial));

  return {
    get: (name) => Effect.succeed(store.get(name) ?? null),
    set: (name, value) =>
      Effect.sync(() => {
        store.set(name, value);
      }),
    delete: (name) => Effect.sync(() => store.delete(name)),
  };
};

/** A `FurlConfigServiceShape` backed by plain in-memory values — never touches the filesystem. */
export const makeConfigStub = (
  options: {
    order?: readonly string[];
    plugins?: Readonly<Record<string, PluginConfigValue>>;
  } = {},
): FurlConfigServiceShape => ({
  read: Effect.succeed({ order: options.order, plugins: options.plugins }),
  resolveProvider: () => Effect.succeed('jina'),
  resolveOrder: Effect.succeed(options.order ?? ['*', 'default:*']),
  pluginArgs: (id) => Effect.succeed(options.plugins?.[id]),
  isPluginDisabled: (id) => Effect.succeed(options.plugins?.[id] === false),
  write: () => Effect.succeed(undefined),
});

/** A minimal `Resolver` fixture that declines by default. */
export const makeResolverStub = (
  overrides: Partial<Resolver> & { id: string },
): Resolver => ({
  isDefault: false,
  match: null,
  specificity: matchAnySpecificity,
  run: () => Effect.succeed<ResolveOutcome>({ _tag: 'decline' }),
  ...overrides,
});

/**
 * A test `HttpClient` whose responses come from a handler you provide instead
 * of the network. `handler` receives the outgoing request URL and returns a
 * standard Web `Response`; a thrown error becomes a typed `HttpClientError`
 * (transport failure), matching what the real fetch-based client would do.
 */
export const makeHttpClientStub = (
  handler: (url: string) => Response,
): HttpClient.HttpClient =>
  HttpClient.make((request) =>
    Effect.try({
      try: () => HttpClientResponse.fromWeb(request, handler(request.url)),
      catch: (cause) =>
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({
            request: request,
            cause: cause,
          }),
        }),
    }),
  );
