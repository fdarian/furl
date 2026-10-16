import { type Context, Effect, Option } from 'effect';
import { type HttpClient, HttpClientRequest } from 'effect/unstable/http';

import { FetchError } from '../../errors.ts';

export type HttpClientService = Context.Service.Shape<
  typeof HttpClient.HttpClient
>;

export const defaultResolverNames = [
  'raw',
  'direct',
  'md-suffix',
  'jina',
  'firecrawl',
  'exa',
] as const;

export type DefaultResolverName = (typeof defaultResolverNames)[number];

export const defaultWildcardResolverNames = [
  'raw',
  'direct',
  'md-suffix',
] as const;

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

const responseIsHtml = (contentType: string | undefined): boolean => {
  if (contentType === undefined) {
    return false;
  }
  return contentType.toLowerCase().includes('text/html');
};

const isSuccessStatus = (status: number): boolean =>
  status >= 200 && status < 300;

/** Fetches the body as-is. Declines (`none`) when the server answers with HTML. */
export const tryRawFetch = (
  client: HttpClientService,
  url: string,
): Effect.Effect<Option.Option<string>, FetchError> =>
  Effect.gen(function* () {
    const response = yield* HttpClientRequest.get(url).pipe(
      client.execute,
      Effect.mapError(
        (cause) =>
          new FetchError({ url: url, status: undefined, cause: cause }),
      ),
    );

    if (!isSuccessStatus(response.status)) {
      return yield* new FetchError({
        url: url,
        status: response.status,
        cause: new Error(`Unexpected status ${response.status}`),
      });
    }

    if (responseIsHtml(response.headers['content-type'])) {
      return Option.none<string>();
    }

    const body = yield* response.text.pipe(
      Effect.mapError(
        (cause) =>
          new FetchError({ url: url, status: response.status, cause: cause }),
      ),
    );
    return Option.some(body);
  });

/**
 * Asks for markdown. Non-2xx and non-markdown responses are declines (`none`);
 * transport and body-read failures propagate as `FetchError`.
 */
export const tryDirectMarkdownFetch = (
  client: HttpClientService,
  url: string,
): Effect.Effect<Option.Option<string>, FetchError> =>
  Effect.gen(function* () {
    const response = yield* HttpClientRequest.get(url).pipe(
      HttpClientRequest.setHeader('Accept', 'text/markdown'),
      client.execute,
      Effect.mapError(
        (cause) =>
          new FetchError({ url: url, status: undefined, cause: cause }),
      ),
    );

    if (
      !isSuccessStatus(response.status) ||
      !responseIsMarkdown(response.headers['content-type'])
    ) {
      return Option.none<string>();
    }

    const body = yield* response.text.pipe(
      Effect.mapError(
        (cause) =>
          new FetchError({ url: url, status: response.status, cause: cause }),
      ),
    );
    return Option.some(body);
  });
