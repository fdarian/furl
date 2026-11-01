import { Effect } from 'effect';
import { HttpClient, HttpClientError, HttpClientResponse } from 'effect/http';

import {
  ResolveDecline,
  type ResolveOutcome,
  type Resolver,
} from './resolver.ts';

export const makeResolverStub = (
  overrides: Partial<Resolver> & { id: string },
): Resolver => ({
  match: null,
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
