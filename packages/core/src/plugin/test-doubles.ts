import { Effect } from 'effect';
import {
  HttpClient,
  HttpClientError,
  HttpClientResponse,
} from 'effect/unstable/http';

import { matchAnySpecificity, type Resolver } from './resolver.ts';
import { ResolveDecline, type ResolveOutcome } from './types.ts';

export const makeSecretsStub = (
  initial: Readonly<Record<string, string>> = {},
) => {
  const store = new Map(Object.entries(initial));

  return {
    get: (name: string) =>
      Effect.sync(() => {
        const value = store.get(name);
        return value === undefined ? null : value;
      }),
    set: (name: string, value: string) =>
      Effect.sync(() => {
        store.set(name, value);
      }),
    delete: (name: string) => Effect.sync(() => store.delete(name)),
  };
};

export const makeResolverStub = (
  overrides: Partial<Resolver> & { id: string },
): Resolver => ({
  isDefault: false,
  match: null,
  specificity: matchAnySpecificity,
  run: () => Effect.succeed<ResolveOutcome>(new ResolveDecline()),
  ...overrides,
});

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
