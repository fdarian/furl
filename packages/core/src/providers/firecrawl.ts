import { type Context, Effect, Schema } from 'effect';
import { type HttpClient, HttpClientRequest } from 'effect/unstable/http';

import { FetchError, ProviderError } from '../errors.ts';
import type { SecretsService } from '../secrets-service.ts';

import { getRequiredProviderKey } from './provider-key.ts';

const firecrawlResponseSchema = Schema.Struct({
  data: Schema.Struct({
    markdown: Schema.optional(Schema.String),
  }),
});

const decodeFirecrawlResponse = Schema.decodeUnknownEffect(
  firecrawlResponseSchema,
);

export const fetchWithFirecrawl = (
  client: Context.Service.Shape<typeof HttpClient.HttpClient>,
  secrets: SecretsService,
  url: string,
) =>
  Effect.gen(function* () {
    const key = yield* getRequiredProviderKey(
      secrets,
      'firecrawl',
      'FIRECRAWL_API_KEY',
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
    const response = yield* request.pipe(
      client.execute,
      Effect.mapError(
        (cause) =>
          new FetchError({ url: url, status: undefined, cause: cause }),
      ),
    );
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
      return yield* Effect.fail(
        new ProviderError({
          provider: 'firecrawl',
          cause: new Error('Firecrawl response is missing data.markdown'),
        }),
      );
    }

    return decoded.data.markdown;
  });
