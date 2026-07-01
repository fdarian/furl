import { type Context, Effect, Option } from 'effect';
import { type HttpClient, HttpClientRequest } from 'effect/unstable/http';

import { FetchError } from '../../errors.ts';

export type HttpClientService = Context.Service.Shape<
  typeof HttpClient.HttpClient
>;

/** The six built-in `default:` resolver names, in furl's canonical internal order. */
export const defaultResolverNames = [
  'raw',
  'direct',
  'md-suffix',
  'jina',
  'exa',
  'firecrawl',
] as const;

export type DefaultResolverName = (typeof defaultResolverNames)[number];

export const fileExtensionPattern = /\.[a-z0-9]+$/i;

const responseIsMarkdown = (contentType: string | undefined): boolean => {
  if (contentType === undefined) {
    return false;
  }

  return contentType.toLowerCase().includes('markdown');
};

export const appendMarkdownSuffix = (url: string): string => {
  const parsedUrl = new URL(url);
  parsedUrl.pathname = `${parsedUrl.pathname}.md`;
  return parsedUrl.toString();
};

export const fetchRawBody = (
  client: HttpClientService,
  url: string,
): Effect.Effect<string, FetchError> =>
  Effect.gen(function* () {
    const response = yield* HttpClientRequest.get(url).pipe(
      client.execute,
      Effect.mapError(
        (cause) =>
          new FetchError({ url: url, status: undefined, cause: cause }),
      ),
    );

    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(
        new FetchError({
          url: url,
          status: response.status,
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

/** Fetches `url` with `Accept: text/markdown`; any failure (network, non-2xx, non-markdown) declines silently. */
export const tryDirectMarkdownFetch = (
  client: HttpClientService,
  url: string,
): Effect.Effect<Option.Option<string>> =>
  Effect.gen(function* () {
    const response = yield* HttpClientRequest.get(url).pipe(
      HttpClientRequest.setHeader('Accept', 'text/markdown'),
      client.execute,
      Effect.mapError(
        (cause) =>
          new FetchError({ url: url, status: undefined, cause: cause }),
      ),
    );

    if (response.status < 200 || response.status >= 300) {
      return Option.none<string>();
    }

    if (!responseIsMarkdown(response.headers['content-type'])) {
      return Option.none<string>();
    }

    const body = yield* response.text.pipe(
      Effect.mapError(
        (cause) =>
          new FetchError({ url: url, status: response.status, cause: cause }),
      ),
    );

    return Option.some(body);
  }).pipe(
    Effect.catchTag('FetchError', () => Effect.succeed(Option.none<string>())),
  );
