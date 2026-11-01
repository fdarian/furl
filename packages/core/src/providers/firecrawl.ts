import { Effect, Schema } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';

import { FetchError, ProviderError, ResolverError } from '../errors.ts';
import {
  type ResolveOutcome,
  type Resolver,
  ResolveSuccess,
} from '../resolver.ts';

import { type ApiKeyOptions, getRequiredProviderKey } from './api-key.ts';

const firecrawlResponseSchema = Schema.Struct({
  data: Schema.Struct({
    markdown: Schema.optional(Schema.String),
  }),
});

const decodeFirecrawlResponse = Schema.decodeUnknownEffect(
  firecrawlResponseSchema,
);

const fetchWithFirecrawl = (options: ApiKeyOptions, url: string) =>
  Effect.gen(function* () {
    const key = yield* getRequiredProviderKey(
      'firecrawl',
      'FIRECRAWL_API_KEY',
      options.apiKey,
    );
    const request = yield* HttpClientRequest.post(
      'https://api.firecrawl.dev/v1/scrape',
    ).pipe(
      HttpClientRequest.setHeader('Authorization', `Bearer ${key}`),
      HttpClientRequest.bodyJson({ url: url, formats: ['markdown'] }),
      Effect.mapError(
        (cause) => new ProviderError({ provider: 'firecrawl', cause: cause }),
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
        provider: 'firecrawl',
        cause: new Error(`Unexpected status ${response.status}`),
      });
    }

    const body = yield* response.json.pipe(
      Effect.mapError(
        (cause) =>
          new FetchError({ url: url, status: response.status, cause: cause }),
      ),
    );
    const decoded = yield* decodeFirecrawlResponse(body).pipe(
      Effect.mapError(
        (cause) => new ProviderError({ provider: 'firecrawl', cause: cause }),
      ),
    );

    if (decoded.data.markdown === undefined) {
      return yield* new ProviderError({
        provider: 'firecrawl',
        cause: new Error('Firecrawl response is missing data.markdown'),
      });
    }

    return decoded.data.markdown;
  });

export const firecrawlResolver = (options: ApiKeyOptions = {}): Resolver => ({
  id: 'firecrawl',
  match: null,
  run: (url) =>
    fetchWithFirecrawl(options, url.toString()).pipe(
      Effect.map(
        (markdown): ResolveOutcome =>
          new ResolveSuccess({ markdown: markdown }),
      ),
      Effect.mapError(
        (cause) => new ResolverError({ id: 'firecrawl', cause: cause }),
      ),
    ),
});
