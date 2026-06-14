import { Context, Effect, Layer, Option } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/unstable/http';
import type { FurlConfigServiceShape } from './config-service.ts';
import { FurlConfigService, FurlConfigServiceLive } from './config-service.ts';
import {
  type ConfigError,
  FetchError,
  type KeychainError,
  type NoProviderKey,
  type ProviderError,
} from './errors.ts';
import type { ProviderName } from './provider-name.ts';
import { fetchWithExa } from './providers/exa.ts';
import { fetchWithFirecrawl } from './providers/firecrawl.ts';
import { fetchWithJina } from './providers/jina.ts';
import type { SecretsService } from './secrets-service.ts';
import { Secrets, SecretsLive } from './secrets-service.ts';

export type FetchResult = {
  markdown: string;
  source:
    | 'raw'
    | 'direct'
    | 'md-suffix'
    | 'provider:jina'
    | 'provider:exa'
    | 'provider:firecrawl';
};

const fileExtensionPattern = /\.[a-z0-9]+$/i;

const responseIsMarkdown = (contentType: string | undefined): boolean => {
  if (contentType === undefined) {
    return false;
  }

  return contentType.toLowerCase().includes('markdown');
};

const appendMarkdownSuffix = (url: string): string => {
  const parsedUrl = new URL(url);
  parsedUrl.pathname = `${parsedUrl.pathname}.md`;
  return parsedUrl.toString();
};

const fetchRawBody = (
  client: Context.Service.Shape<typeof HttpClient.HttpClient>,
  url: string,
) =>
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

    const body = yield* response.text.pipe(
      Effect.mapError(
        (cause) =>
          new FetchError({ url: url, status: response.status, cause: cause }),
      ),
    );

    return {
      markdown: body,
      source: 'raw',
    } satisfies FetchResult;
  });

const tryDirectMarkdownFetch = (
  client: Context.Service.Shape<typeof HttpClient.HttpClient>,
  url: string,
  source: 'direct' | 'md-suffix',
) =>
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
      return Option.none<FetchResult>();
    }

    const contentType = response.headers['content-type'];

    if (!responseIsMarkdown(contentType)) {
      return Option.none<FetchResult>();
    }

    const body = yield* response.text.pipe(
      Effect.mapError(
        (cause) =>
          new FetchError({ url: url, status: response.status, cause: cause }),
      ),
    );

    return Option.some({
      markdown: body,
      source: source,
    } satisfies FetchResult);
  }).pipe(
    Effect.catchTag('FetchError', () =>
      Effect.succeed(Option.none<FetchResult>()),
    ),
  );

const fetchWithProvider = (
  client: Context.Service.Shape<typeof HttpClient.HttpClient>,
  secrets: SecretsService,
  provider: ProviderName,
  url: string,
) => {
  if (provider === 'exa') {
    return fetchWithExa(client, secrets, url).pipe(
      Effect.map((markdown) => ({
        markdown: markdown,
        source: 'provider:exa' as const,
      })),
    );
  }

  if (provider === 'firecrawl') {
    return fetchWithFirecrawl(client, secrets, url).pipe(
      Effect.map((markdown) => ({
        markdown: markdown,
        source: 'provider:firecrawl' as const,
      })),
    );
  }

  return fetchWithJina(client, secrets, url).pipe(
    Effect.map((markdown) => ({
      markdown: markdown,
      source: 'provider:jina' as const,
    })),
  );
};

const fetchMarkdown = (
  client: Context.Service.Shape<typeof HttpClient.HttpClient>,
  config: FurlConfigServiceShape,
  secrets: SecretsService,
  url: string,
  providerOverride: Option.Option<ProviderName>,
) =>
  Effect.gen(function* () {
    const parsedUrl = yield* Effect.try({
      try: () => new URL(url),
      catch: (cause) =>
        new FetchError({
          url: url,
          status: undefined,
          cause: cause,
        }),
    });
    const pathnameSegments = parsedUrl.pathname.split('/');
    const lastPathSegment = pathnameSegments[pathnameSegments.length - 1];

    if (lastPathSegment === undefined) {
      return yield* Effect.fail(
        new FetchError({
          url: url,
          status: undefined,
          cause: new Error('Unable to resolve URL pathname'),
        }),
      );
    }

    if (fileExtensionPattern.test(lastPathSegment)) {
      return yield* fetchRawBody(client, url);
    }

    const directFetch = yield* tryDirectMarkdownFetch(client, url, 'direct');

    if (Option.isSome(directFetch)) {
      return directFetch.value;
    }

    const markdownUrl = appendMarkdownSuffix(url);
    const markdownFetch = yield* tryDirectMarkdownFetch(
      client,
      markdownUrl,
      'md-suffix',
    );

    if (Option.isSome(markdownFetch)) {
      return markdownFetch.value;
    }

    const provider = yield* config.resolveProvider(providerOverride);
    return yield* fetchWithProvider(client, secrets, provider, url);
  });

export class Furl extends Context.Service<
  Furl,
  {
    fetch: (url: string) => Effect.Effect<FetchResult, FurlError>;
    fetchWithProvider: (
      url: string,
      provider: ProviderName,
    ) => Effect.Effect<FetchResult, FurlError>;
  }
>()('furl/core') {}

export const FurlLive = Layer.effect(
  Furl,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const config = yield* FurlConfigService;
    const secrets = yield* Secrets;

    return {
      fetch: (url: string) =>
        fetchMarkdown(client, config, secrets, url, Option.none()),
      fetchWithProvider: (url: string, provider: ProviderName) =>
        fetchMarkdown(client, config, secrets, url, Option.some(provider)),
    };
  }),
).pipe(Layer.provide(SecretsLive), Layer.provide(FurlConfigServiceLive));

export type FurlError =
  | ConfigError
  | FetchError
  | KeychainError
  | NoProviderKey
  | ProviderError;
