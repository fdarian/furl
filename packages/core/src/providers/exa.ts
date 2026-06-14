import { type Context, Effect, Schema } from 'effect';
import { type HttpClient, HttpClientRequest } from 'effect/unstable/http';

import { FetchError, ProviderError } from '../errors.ts';
import type { SecretsService } from '../secrets-service.ts';

import { getRequiredProviderKey } from './provider-key.ts';

const exaResponseSchema = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      text: Schema.optional(Schema.String),
    }),
  ),
});

const decodeExaResponse = Schema.decodeUnknownEffect(exaResponseSchema);

export const fetchWithExa = (
  client: Context.Service.Shape<typeof HttpClient.HttpClient>,
  secrets: SecretsService,
  url: string,
) =>
  Effect.gen(function* () {
    const key = yield* getRequiredProviderKey(secrets, 'exa', 'EXA_API_KEY');
    const request = yield* HttpClientRequest.post(
      'https://api.exa.ai/contents',
    ).pipe(
      HttpClientRequest.setHeader('x-api-key', key),
      HttpClientRequest.bodyJson({ urls: [url], text: true }),
      Effect.mapError(
        (cause) => new ProviderError({ provider: 'exa', cause: cause }),
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
    const decoded = yield* decodeExaResponse(body).pipe(
      Effect.mapError(
        (cause) => new ProviderError({ provider: 'exa', cause: cause }),
      ),
    );
    const firstResult = decoded.results[0];

    if (firstResult === undefined) {
      return yield* Effect.fail(
        new ProviderError({
          provider: 'exa',
          cause: new Error('Exa returned no results'),
        }),
      );
    }

    if (firstResult.text === undefined) {
      return yield* Effect.fail(
        new ProviderError({
          provider: 'exa',
          cause: new Error('Exa response is missing results[0].text'),
        }),
      );
    }

    return firstResult.text;
  });
