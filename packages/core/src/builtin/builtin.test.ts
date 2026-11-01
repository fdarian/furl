import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect, Option } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';

import { runResolvers } from '../engine.ts';
import { FetchError, NoProviderKey, ResolverError } from '../errors.ts';
import { ResolveDecline, type Resolver, ResolveSuccess } from '../resolver.ts';
import { Resolvers } from '../resolvers.ts';
import { makeHttpClientStub, makeResolverStub } from '../test-doubles.ts';

/** Binds the stub client so `run` needs no environment. */
const bind = (resolver: Resolver, client: HttpClient.HttpClient) => ({
  ...resolver,
  run: (url: URL) =>
    resolver
      .run(url)
      .pipe(Effect.provideService(HttpClient.HttpClient, client)),
});

describe('raw', () => {
  it('declines a URL without a file extension without fetching', async () => {
    const client = makeHttpClientStub(() => {
      throw new Error('should not fetch');
    });
    const raw = bind(Resolvers.raw, client);

    const outcome = await Effect.runPromise(
      raw.run(new URL('https://example.com/page')),
    );

    expect(outcome).toEqual(new ResolveDecline());
  });

  it('succeeds with the raw body for a file-extension URL', async () => {
    const client = makeHttpClientStub(
      () => new Response('# raw body', { status: 200 }),
    );
    const raw = bind(Resolvers.raw, client);

    const outcome = await Effect.runPromise(
      raw.run(new URL('https://example.com/file.md')),
    );

    expect(outcome).toEqual(new ResolveSuccess({ markdown: '# raw body' }));
  });

  it('fails with a ResolverError when a file-extension fetch fails', async () => {
    const client = makeHttpClientStub(
      () => new Response('not found', { status: 404 }),
    );
    const raw = bind(Resolvers.raw, client);

    const error = await Effect.runPromise(
      Effect.flip(raw.run(new URL('https://example.com/report.pdf'))),
    );

    expect(error).toBeInstanceOf(ResolverError);
    if (!(error instanceof ResolverError)) {
      throw new Error(`expected ResolverError, got ${error._tag}`);
    }
    expect(error.id).toBe('raw');
    expect(error.cause).toBeInstanceOf(FetchError);
  });

  it('records a raw failure and continues to the next resolver', async () => {
    const client = makeHttpClientStub(
      () => new Response('not found', { status: 404 }),
    );
    const raw = bind(Resolvers.raw, client);
    const fallback = makeResolverStub({
      id: 'fallback',
      run: () => Effect.succeed(new ResolveSuccess({ markdown: '# fallback' })),
    });

    const result = await Effect.runPromise(
      runResolvers(new URL('https://example.com/page.html'), [
        raw,
        fallback,
      ]).pipe(Effect.provideService(HttpClient.HttpClient, client)),
    );

    expect(result).toEqual({
      markdown: '# fallback',
      source: 'fallback',
    });
  });

  it('reports a failed raw fetch in AllResolversFailed when nothing else succeeds', async () => {
    const client = makeHttpClientStub(
      () => new Response('not found', { status: 404 }),
    );
    const raw = bind(Resolvers.raw, client);

    const error = await Effect.runPromise(
      Effect.flip(
        runResolvers(new URL('https://example.com/report.pdf'), [raw]).pipe(
          Effect.provideService(HttpClient.HttpClient, client),
        ),
      ),
    );

    expect(error._tag).toBe('AllResolversFailed');
    expect(error.message).toContain('raw');
    expect(error.message).toContain('status 404');
  });

  it('declines an HTML response for a file-extension URL', async () => {
    const client = makeHttpClientStub(
      () =>
        new Response('<html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    );
    const raw = bind(Resolvers.raw, client);

    const outcome = await Effect.runPromise(
      raw.run(new URL('https://en.wikipedia.org/wiki/Node.js')),
    );

    expect(outcome).toEqual(new ResolveDecline());
  });

  it('still returns non-HTML bodies for a file-extension URL', async () => {
    const client = makeHttpClientStub(
      () =>
        new Response('{"a":1}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const raw = bind(Resolvers.raw, client);

    const outcome = await Effect.runPromise(
      raw.run(new URL('https://example.com/data.json')),
    );

    expect(outcome).toEqual(new ResolveSuccess({ markdown: '{"a":1}' }));
  });
});

describe('direct', () => {
  it('declines a non-markdown response', async () => {
    const client = makeHttpClientStub(
      () =>
        new Response('<html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );
    const direct = bind(Resolvers.direct, client);

    const outcome = await Effect.runPromise(
      direct.run(new URL('https://example.com/page')),
    );

    expect(outcome).toEqual(new ResolveDecline());
  });

  it('succeeds when the response content type is markdown', async () => {
    const client = makeHttpClientStub(
      () =>
        new Response('# hello', {
          status: 200,
          headers: { 'content-type': 'text/markdown' },
        }),
    );
    const direct = bind(Resolvers.direct, client);

    const outcome = await Effect.runPromise(
      direct.run(new URL('https://example.com/page')),
    );

    expect(outcome).toEqual(new ResolveSuccess({ markdown: '# hello' }));
  });

  it('declines a non-2xx response', async () => {
    const client = makeHttpClientStub(
      () =>
        new Response('nope', {
          status: 404,
          headers: { 'content-type': 'text/markdown' },
        }),
    );
    const direct = bind(Resolvers.direct, client);

    const outcome = await Effect.runPromise(
      direct.run(new URL('https://example.com/page')),
    );

    expect(outcome).toEqual(new ResolveDecline());
  });

  it('fails with a ResolverError on a transport failure', async () => {
    const client = makeHttpClientStub(() => {
      throw new Error('network down');
    });
    const direct = bind(Resolvers.direct, client);

    const error = await Effect.runPromise(
      Effect.flip(direct.run(new URL('https://example.com/page'))),
    );

    expect(error._tag).toBe('ResolverError');
    if (!(error instanceof ResolverError)) {
      throw new Error(`expected ResolverError, got ${error._tag}`);
    }
    expect(error.id).toBe('direct');
    expect(error.cause).toBeInstanceOf(FetchError);
  });

  it('fails with a ResolverError when the body cannot be read', async () => {
    const failingBody = new ReadableStream({
      start: (controller) => controller.error(new Error('stream broke')),
    });
    const client = makeHttpClientStub(
      () =>
        new Response(failingBody, {
          status: 200,
          headers: { 'content-type': 'text/markdown' },
        }),
    );
    const direct = bind(Resolvers.direct, client);

    const error = await Effect.runPromise(
      Effect.flip(direct.run(new URL('https://example.com/page'))),
    );

    expect(error._tag).toBe('ResolverError');
    expect(error.cause).toBeInstanceOf(FetchError);
  });
});

describe('md-suffix', () => {
  it('requests the URL with .md appended and reports success', async () => {
    const requestedUrls: string[] = [];
    const client = makeHttpClientStub((url) => {
      requestedUrls.push(url);
      return new Response('# suffixed', {
        status: 200,
        headers: { 'content-type': 'text/markdown' },
      });
    });
    const mdSuffix = bind(Resolvers.mdSuffix, client);

    const outcome = await Effect.runPromise(
      mdSuffix.run(new URL('https://example.com/page')),
    );

    expect(outcome).toEqual(new ResolveSuccess({ markdown: '# suffixed' }));
    expect(requestedUrls).toEqual(['https://example.com/page.md']);
  });

  it('fails with a ResolverError on a transport failure', async () => {
    const client = makeHttpClientStub(() => {
      throw new Error('network down');
    });
    const mdSuffix = bind(Resolvers.mdSuffix, client);

    const error = await Effect.runPromise(
      Effect.flip(mdSuffix.run(new URL('https://example.com/page'))),
    );

    expect(error._tag).toBe('ResolverError');
    if (!(error instanceof ResolverError)) {
      throw new Error(`expected ResolverError, got ${error._tag}`);
    }
    expect(error.id).toBe('md-suffix');
  });

  it('declines a 404 for the suffixed URL', async () => {
    const client = makeHttpClientStub(
      () => new Response('missing', { status: 404 }),
    );
    const mdSuffix = bind(Resolvers.mdSuffix, client);

    const outcome = await Effect.runPromise(
      mdSuffix.run(new URL('https://example.com/page')),
    );

    expect(outcome).toEqual(new ResolveDecline());
  });
});

const noEnv = ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }));

/** Echoes the request headers and URL so key placement can be asserted. */
const recordingClient = (
  requests: { url: string; headers: Readonly<Record<string, string>> }[],
) =>
  HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push({
        url: request.url,
        headers: request.headers,
      });
      return HttpClientResponse.fromWeb(
        request,
        new Response(
          JSON.stringify({
            results: [{ text: '# via exa' }],
            data: { markdown: '# via firecrawl' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }),
  );

describe('provider resolvers', () => {
  const url = new URL('https://example.com/page');

  it('fails an Exa run without a key as NoProviderKey, without making a request', async () => {
    const client = makeHttpClientStub(() => {
      throw new Error('should not fetch');
    });
    const exa = bind(Resolvers.exa(), client);

    const error = await Effect.runPromise(
      Effect.flip(exa.run(url)).pipe(Effect.provide(noEnv)),
    );

    expect(error._tag).toBe('ResolverError');
    expect(error.cause).toBeInstanceOf(NoProviderKey);
  });

  it('fails a Firecrawl run without a key as NoProviderKey, without making a request', async () => {
    const client = makeHttpClientStub(() => {
      throw new Error('should not fetch');
    });
    const firecrawl = bind(Resolvers.firecrawl(), client);

    const error = await Effect.runPromise(
      Effect.flip(firecrawl.run(url)).pipe(Effect.provide(noEnv)),
    );

    expect(error._tag).toBe('ResolverError');
    expect(error.cause).toBeInstanceOf(NoProviderKey);
  });

  it('reads the provider environment variable when apiKey is omitted', async () => {
    const requests: {
      url: string;
      headers: Readonly<Record<string, string>>;
    }[] = [];
    const exa = bind(Resolvers.exa(), recordingClient(requests));
    const env = ConfigProvider.layer(
      ConfigProvider.fromEnv({ env: { EXA_API_KEY: 'env-key' } }),
    );

    const outcome = await Effect.runPromise(
      exa.run(url).pipe(Effect.provide(env)),
    );

    expect(outcome).toEqual(new ResolveSuccess({ markdown: '# via exa' }));
    expect(requests[0]?.headers['x-api-key']).toBe('env-key');
  });

  it('sends a literal apiKey', async () => {
    const requests: {
      url: string;
      headers: Readonly<Record<string, string>>;
    }[] = [];
    const firecrawl = bind(
      Resolvers.firecrawl({ apiKey: 'abc' }),
      recordingClient(requests),
    );

    const outcome = await Effect.runPromise(firecrawl.run(url));

    expect(outcome).toEqual(
      new ResolveSuccess({ markdown: '# via firecrawl' }),
    );
    expect(requests[0]?.headers.authorization).toBe('Bearer abc');
  });

  it('evaluates an apiKey effect on every run', async () => {
    const requests: {
      url: string;
      headers: Readonly<Record<string, string>>;
    }[] = [];
    let calls = 0;
    const exa = bind(
      Resolvers.exa({
        apiKey: Effect.sync(() => {
          calls += 1;
          return Option.some(`key-${calls}`);
        }),
      }),
      recordingClient(requests),
    );

    await Effect.runPromise(exa.run(url));
    await Effect.runPromise(exa.run(url));

    expect(requests.map((request) => request.headers['x-api-key'])).toEqual([
      'key-1',
      'key-2',
    ]);
  });

  it('treats a None apiKey as NoProviderKey for Exa', async () => {
    const client = makeHttpClientStub(() => {
      throw new Error('should not fetch');
    });
    const exa = bind(
      Resolvers.exa({ apiKey: Effect.succeed(Option.none()) }),
      client,
    );

    const error = await Effect.runPromise(Effect.flip(exa.run(url)));

    expect(error.cause).toBeInstanceOf(NoProviderKey);
  });

  it('treats a None apiKey as keyless for Jina', async () => {
    const requests: {
      url: string;
      headers: Readonly<Record<string, string>>;
    }[] = [];
    const jina = bind(
      Resolvers.jina({ apiKey: Effect.succeed(Option.none()) }),
      recordingClient(requests),
    );

    await Effect.runPromise(jina.run(url));

    expect(requests[0]?.headers.authorization).toBeUndefined();
  });

  it('surfaces a failing apiKey effect as the ResolverError cause', async () => {
    const client = makeHttpClientStub(() => {
      throw new Error('should not fetch');
    });
    const cause = new Error('keychain locked');
    const exa = bind(Resolvers.exa({ apiKey: Effect.fail(cause) }), client);

    const error = await Effect.runPromise(Effect.flip(exa.run(url)));

    expect(error).toBeInstanceOf(ResolverError);
    expect(error.cause).toBe(cause);
  });

  it('wraps an Exa API failure as a ResolverError', async () => {
    const client = makeHttpClientStub(
      () => new Response('server error', { status: 500 }),
    );
    const exa = bind(Resolvers.exa({ apiKey: 'test-key' }), client);

    const error = await Effect.runPromise(Effect.flip(exa.run(url)));

    expect(error).toBeInstanceOf(ResolverError);
    expect(error).toMatchObject({ id: 'exa' });
  });

  it('reports Jina HTTP failures as ResolverError', async () => {
    const client = makeHttpClientStub(
      () => new Response('rate limited', { status: 429 }),
    );
    const jina = bind(Resolvers.jina(), client);

    const error = await Effect.runPromise(
      Effect.flip(jina.run(url)).pipe(Effect.provide(noEnv)),
    );

    expect(error).toBeInstanceOf(ResolverError);
    expect(error).toMatchObject({ id: 'jina' });
  });

  it('succeeds with the Jina response body', async () => {
    const client = makeHttpClientStub(
      () => new Response('# via jina', { status: 200 }),
    );
    const jina = bind(Resolvers.jina(), client);

    const outcome = await Effect.runPromise(
      jina.run(url).pipe(Effect.provide(noEnv)),
    );

    expect(outcome).toEqual(new ResolveSuccess({ markdown: '# via jina' }));
  });
});
