import { type Context, Effect, Option } from 'effect';
import { type HttpClient, HttpClientRequest } from 'effect/unstable/http';

import { FetchError, ResolverError } from '../errors.ts';
import { fetchWithExa } from '../providers/exa.ts';
import { fetchWithFirecrawl } from '../providers/firecrawl.ts';
import { fetchWithJina } from '../providers/jina.ts';
import type { SecretsService } from '../secrets-service.ts';

import { matchAnySpecificity, type Resolver } from './resolver.ts';
import type { ResolveOutcome } from './types.ts';

type HttpClientService = Context.Service.Shape<typeof HttpClient.HttpClient>;

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
const tryDirectMarkdownFetch = (
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

const rawResolver = (client: HttpClientService): Resolver => ({
  id: 'raw',
  isDefault: true,
  match: null,
  specificity: matchAnySpecificity,
  run: (url) =>
    Effect.gen(function* () {
      if (!fileExtensionPattern.test(url.pathname)) {
        return { _tag: 'decline' } satisfies ResolveOutcome;
      }

      const markdown = yield* fetchRawBody(client, url.toString()).pipe(
        Effect.mapError(
          (cause) => new ResolverError({ id: 'raw', cause: cause }),
        ),
      );

      return { _tag: 'success', markdown: markdown } satisfies ResolveOutcome;
    }),
});

const directResolver = (client: HttpClientService): Resolver => ({
  id: 'direct',
  isDefault: true,
  match: null,
  specificity: matchAnySpecificity,
  run: (url) =>
    tryDirectMarkdownFetch(client, url.toString()).pipe(
      Effect.map(
        (result): ResolveOutcome =>
          Option.isSome(result)
            ? { _tag: 'success', markdown: result.value }
            : { _tag: 'decline' },
      ),
    ),
});

const mdSuffixResolver = (client: HttpClientService): Resolver => ({
  id: 'md-suffix',
  isDefault: true,
  match: null,
  specificity: matchAnySpecificity,
  run: (url) =>
    tryDirectMarkdownFetch(client, appendMarkdownSuffix(url.toString())).pipe(
      Effect.map(
        (result): ResolveOutcome =>
          Option.isSome(result)
            ? { _tag: 'success', markdown: result.value }
            : { _tag: 'decline' },
      ),
    ),
});

const jinaResolver = (
  client: HttpClientService,
  secrets: SecretsService,
): Resolver => ({
  id: 'jina',
  isDefault: true,
  match: null,
  specificity: matchAnySpecificity,
  run: (url) =>
    fetchWithJina(client, secrets, url.toString()).pipe(
      Effect.map(
        (markdown): ResolveOutcome => ({ _tag: 'success', markdown: markdown }),
      ),
      Effect.mapError(
        (cause) => new ResolverError({ id: 'jina', cause: cause }),
      ),
    ),
});

const exaResolver = (
  client: HttpClientService,
  secrets: SecretsService,
): Resolver => ({
  id: 'exa',
  isDefault: true,
  match: null,
  specificity: matchAnySpecificity,
  run: (url) =>
    fetchWithExa(client, secrets, url.toString()).pipe(
      Effect.map(
        (markdown): ResolveOutcome => ({ _tag: 'success', markdown: markdown }),
      ),
      Effect.catchTag('NoProviderKey', () =>
        Effect.succeed<ResolveOutcome>({ _tag: 'decline' }),
      ),
      Effect.mapError(
        (cause) => new ResolverError({ id: 'exa', cause: cause }),
      ),
    ),
});

const firecrawlResolver = (
  client: HttpClientService,
  secrets: SecretsService,
): Resolver => ({
  id: 'firecrawl',
  isDefault: true,
  match: null,
  specificity: matchAnySpecificity,
  run: (url) =>
    fetchWithFirecrawl(client, secrets, url.toString()).pipe(
      Effect.map(
        (markdown): ResolveOutcome => ({ _tag: 'success', markdown: markdown }),
      ),
      Effect.catchTag('NoProviderKey', () =>
        Effect.succeed<ResolveOutcome>({ _tag: 'decline' }),
      ),
      Effect.mapError(
        (cause) => new ResolverError({ id: 'firecrawl', cause: cause }),
      ),
    ),
});

/** Builds the six built-in `default:` resolvers, in furl's canonical internal order. */
export const createDefaultResolvers = (
  client: HttpClientService,
  secrets: SecretsService,
): Resolver[] => [
  rawResolver(client),
  directResolver(client),
  mdSuffixResolver(client),
  jinaResolver(client, secrets),
  exaResolver(client, secrets),
  firecrawlResolver(client, secrets),
];
