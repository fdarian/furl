import { Effect, Schema } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';

import { FetchError, ProviderError, ResolverError } from '../errors.ts';
import {
  type ResolveOutcome,
  type Resolver,
  ResolveSuccess,
} from '../resolver.ts';

import { type ApiKeyOptions, getRequiredProviderKey } from './api-key.ts';

const exaResponseSchema = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      text: Schema.optional(Schema.String),
    }),
  ),
});

const decodeExaResponse = Schema.decodeUnknownEffect(exaResponseSchema);

const fetchWithExa = (options: ApiKeyOptions, url: string) =>
  Effect.gen(function* () {
    const key = yield* getRequiredProviderKey(
      'exa',
      'EXA_API_KEY',
      options.apiKey,
    );
    const request = yield* HttpClientRequest.post(
      'https://api.exa.ai/contents',
    ).pipe(
      HttpClientRequest.setHeader('x-api-key', key),
      HttpClientRequest.bodyJson({ urls: [url], text: true }),
      Effect.mapError(
        (cause) => new ProviderError({ provider: 'exa', cause: cause }),
      ),
    );
    const response = yield* HttpClient.execute(request).pipe(
      Effect.mapError(
        (cause) =>
          new FetchError({ url: url, status: undefined, cause: cause }),
      ),
    );

    if (response.status < 200 || response.status >= 300) {
      return yield* new ProviderError({
        provider: 'exa',
        cause: new Error(`Unexpected status ${response.status}`),
      });
    }

    const body = yield* response.json.pipe(
      Effect.mapError(
        (cause) =>
          new FetchError({ url: url, status: response.status, cause: cause }),
      ),
    );
    const decoded = yield* decodeExaResponse(body).pipe(
      Effect.mapError(
        (cause) => new ProviderError({ provider: 'exa', cause: cause }),
      ),
    );
    const firstResult = decoded.results[0];

    if (firstResult === undefined) {
      return yield* new ProviderError({
        provider: 'exa',
        cause: new Error('Exa returned no results'),
      });
    }

    if (firstResult.text === undefined) {
      return yield* new ProviderError({
        provider: 'exa',
        cause: new Error('Exa response is missing results[0].text'),
      });
    }

    return firstResult.text;
  });

export const exaResolver = (options: ApiKeyOptions = {}): Resolver => ({
  id: 'exa',
  match: null,
  run: (url) =>
    fetchWithExa(options, url.toString()).pipe(
      Effect.map(
        (markdown): ResolveOutcome =>
          new ResolveSuccess({ markdown: markdown }),
      ),
      Effect.mapError(
        (cause) => new ResolverError({ id: 'exa', cause: cause }),
      ),
    ),
});
