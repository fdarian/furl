import { type Context, Effect } from 'effect';
import { type HttpClient, HttpClientRequest } from 'effect/unstable/http';

import { FetchError, ProviderError } from '../errors.ts';
import type { SecretsService } from '../secrets-service.ts';

import { getOptionalProviderKey } from './provider-key.ts';

const readerPrefix = 'https://r.jina.ai/';

export const fetchWithJina = (
  client: Context.Service.Shape<typeof HttpClient.HttpClient>,
  secrets: SecretsService,
  url: string,
) =>
  Effect.gen(function* () {
    const optionalKey = yield* getOptionalProviderKey(
      secrets,
      'jina',
      'JINA_API_KEY',
    );
    let request = HttpClientRequest.get(`${readerPrefix}${url}`).pipe(
      HttpClientRequest.setHeader('X-Return-Format', 'markdown'),
      HttpClientRequest.setHeader('Accept', 'text/markdown'),
    );

    if (optionalKey !== null) {
      request = request.pipe(
        HttpClientRequest.setHeader('Authorization', `Bearer ${optionalKey}`),
      );
    }

    const response = yield* request.pipe(
      client.execute,
      Effect.mapError(
        (cause) =>
          new FetchError({ url: url, status: undefined, cause: cause }),
      ),
    );

    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(
        new ProviderError({
          provider: 'jina',
          cause: new Error(`Unexpected status ${response.status}`),
        }),
      );
    }

    return yield* response.text.pipe(
      Effect.mapError(
        (cause) =>
          new FetchError({ url: url, status: response.status, cause: cause }),
      ),
    );
  });
