import { Effect, Option } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';

import { FetchError, ProviderError, ResolverError } from '../errors.ts';
import {
  type ResolveOutcome,
  type Resolver,
  ResolveSuccess,
} from '../resolver.ts';

import { type ApiKeyOptions, getOptionalProviderKey } from './api-key.ts';

const readerPrefix = 'https://r.jina.ai/';

const fetchWithJina = (options: ApiKeyOptions, url: string) =>
  Effect.gen(function* () {
    const optionalKey = yield* getOptionalProviderKey(
      'jina',
      'JINA_API_KEY',
      options.apiKey,
    );
    const baseRequest = HttpClientRequest.get(`${readerPrefix}${url}`).pipe(
      HttpClientRequest.setHeader('X-Return-Format', 'markdown'),
      HttpClientRequest.setHeader('Accept', 'text/markdown'),
    );
    const request = Option.isSome(optionalKey)
      ? baseRequest.pipe(
          HttpClientRequest.setHeader(
            'Authorization',
            `Bearer ${optionalKey.value}`,
          ),
        )
      : baseRequest;

    const response = yield* HttpClient.execute(request).pipe(
      Effect.mapError(
        (cause) =>
          new FetchError({ url: url, status: undefined, cause: cause }),
      ),
    );

    if (response.status < 200 || response.status >= 300) {
      return yield* new ProviderError({
        provider: 'jina',
        cause: new Error(`Unexpected status ${response.status}`),
      });
    }

    return yield* response.text.pipe(
      Effect.mapError(
        (cause) =>
          new FetchError({ url: url, status: response.status, cause: cause }),
      ),
    );
  });

export const jinaResolver = (options: ApiKeyOptions = {}): Resolver => ({
  id: 'jina',
  match: null,
  run: (url) =>
    fetchWithJina(options, url.toString()).pipe(
      Effect.map(
        (markdown): ResolveOutcome =>
          new ResolveSuccess({ markdown: markdown }),
      ),
      Effect.mapError(
        (cause) => new ResolverError({ id: 'jina', cause: cause }),
      ),
    ),
});
