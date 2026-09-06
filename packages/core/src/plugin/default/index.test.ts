import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';

import { runResolvers } from '../engine.ts';
import {
  makeHttpClientStub,
  makeResolverStub,
  makeSecretsStub,
} from '../test-doubles.ts';
import { ResolveDecline, ResolveFailure, ResolveSuccess } from '../types.ts';

import { createDefaultResolvers } from './index.ts';

const findResolver = (
  resolvers: readonly ReturnType<typeof createDefaultResolvers>[number][],
  id: string,
) => {
  const resolver = resolvers.find((candidate) => candidate.id === id);
  if (resolver === undefined) {
    throw new Error(`No resolver named "${id}"`);
  }
  return resolver;
};

describe('raw', () => {
  it('declines a non-file-extension URL without ever fetching', async () => {
    const client = makeHttpClientStub(() => {
      throw new Error('should not fetch');
    });
    const resolvers = createDefaultResolvers(client, makeSecretsStub());
    const raw = findResolver(resolvers, 'raw');

    const outcome = await Effect.runPromise(
      raw.run(new URL('https://example.com/page')),
    );

    expect(outcome).toEqual(new ResolveDecline());
  });

  it('succeeds with the raw body for a file-extension URL', async () => {
    const client = makeHttpClientStub(
      () => new Response('# raw body', { status: 200 }),
    );
    const resolvers = createDefaultResolvers(client, makeSecretsStub());
    const raw = findResolver(resolvers, 'raw');

    const outcome = await Effect.runPromise(
      raw.run(new URL('https://example.com/file.md')),
    );

    expect(outcome).toEqual(new ResolveSuccess({ markdown: '# raw body' }));
  });

  it('aborts (does not decline) when the fetch fails, surfacing its own cause', async () => {
    const client = makeHttpClientStub(
      () => new Response('nope', { status: 500 }),
    );
    const resolvers = createDefaultResolvers(client, makeSecretsStub());
    const raw = findResolver(resolvers, 'raw');

    const outcome = await Effect.runPromise(
      raw.run(new URL('https://example.com/file.md')),
    );

    expect(outcome).toBeInstanceOf(ResolveFailure);
    expect((outcome as ResolveFailure).error._tag).toBe('ResolverError');
    expect((outcome as ResolveFailure).error.id).toBe('raw');
  });

  it('aborts a failed .pdf fetch, a document extension with nowhere else to fall through to', async () => {
    const client = makeHttpClientStub(
      () => new Response('not found', { status: 404 }),
    );
    const resolvers = createDefaultResolvers(client, makeSecretsStub());
    const raw = findResolver(resolvers, 'raw');

    const outcome = await Effect.runPromise(
      raw.run(new URL('https://example.com/report.pdf')),
    );

    expect(outcome).toBeInstanceOf(ResolveFailure);
  });

  it('declines (does not abort) a failed .html fetch, since the extension also covers ordinary web pages', async () => {
    const client = makeHttpClientStub(
      () => new Response('not found', { status: 404 }),
    );
    const resolvers = createDefaultResolvers(client, makeSecretsStub());
    const raw = findResolver(resolvers, 'raw');

    const outcome = await Effect.runPromise(
      raw.run(new URL('https://example.com/page.html')),
    );

    expect(outcome).toEqual(new ResolveDecline());
  });

  it('lets the chain continue past a failed .html fetch, reaching the next resolver', async () => {
    const client = makeHttpClientStub(
      () => new Response('not found', { status: 404 }),
    );
    const resolvers = createDefaultResolvers(client, makeSecretsStub());
    const raw = findResolver(resolvers, 'raw');
    const fallback = makeResolverStub({
      id: 'fallback',
      run: () => Effect.succeed(new ResolveSuccess({ markdown: '# fallback' })),
    });

    const result = await Effect.runPromise(
      runResolvers(new URL('https://example.com/page.html'), [raw, fallback]),
    );

    expect(result).toEqual({ markdown: '# fallback', source: 'fallback' });
  });

  it("reaches the user's configured default provider after a failed .html raw fetch — the order regression this fixes", async () => {
    const client = makeHttpClientStub(
      () => new Response('not found', { status: 404 }),
    );
    const resolvers = createDefaultResolvers(client, makeSecretsStub());
    const raw = findResolver(resolvers, 'raw');
    const mdSuffix = findResolver(resolvers, 'md-suffix');
    // Stands in for a user's chosen `default:<provider>` token, placed by
    // `insertProviderToken` right after the free probes (raw/direct/md-suffix)
    // in `order` — this is the resolver that a too-broad terminal-failure
    // rule on `raw` would otherwise never let the chain reach.
    const userDefaultProvider = makeResolverStub({
      id: 'default:jina',
      run: () => Effect.succeed(new ResolveSuccess({ markdown: '# via jina' })),
    });

    const result = await Effect.runPromise(
      runResolvers(new URL('https://example.com/article.html'), [
        raw,
        mdSuffix,
        userDefaultProvider,
      ]),
    );

    expect(result).toEqual({ markdown: '# via jina', source: 'default:jina' });
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
    const resolvers = createDefaultResolvers(client, makeSecretsStub());
    const direct = findResolver(resolvers, 'direct');

    const outcome = await Effect.runPromise(
      direct.run(new URL('https://example.com/page')),
    );

    expect(outcome).toEqual(new ResolveDecline());
  });

  it('succeeds when the response content-type is markdown', async () => {
    const client = makeHttpClientStub(
      () =>
        new Response('# hello', {
          status: 200,
          headers: { 'content-type': 'text/markdown' },
        }),
    );
    const resolvers = createDefaultResolvers(client, makeSecretsStub());
    const direct = findResolver(resolvers, 'direct');

    const outcome = await Effect.runPromise(
      direct.run(new URL('https://example.com/page')),
    );

    expect(outcome).toEqual(new ResolveSuccess({ markdown: '# hello' }));
  });

  it('declines (not errors) on a transport failure', async () => {
    const client = makeHttpClientStub(() => {
      throw new Error('network down');
    });
    const resolvers = createDefaultResolvers(client, makeSecretsStub());
    const direct = findResolver(resolvers, 'direct');

    const outcome = await Effect.runPromise(
      direct.run(new URL('https://example.com/page')),
    );

    expect(outcome).toEqual(new ResolveDecline());
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
    const resolvers = createDefaultResolvers(client, makeSecretsStub());
    const mdSuffix = findResolver(resolvers, 'md-suffix');

    const outcome = await Effect.runPromise(
      mdSuffix.run(new URL('https://example.com/page')),
    );

    expect(outcome).toEqual(new ResolveSuccess({ markdown: '# suffixed' }));
    expect(requestedUrls).toEqual(['https://example.com/page.md']);
  });
});

describe('exa', () => {
  it('declines when no API key is configured', async () => {
    const originalKey = process.env.EXA_API_KEY;
    delete process.env.EXA_API_KEY;
    try {
      const client = makeHttpClientStub(() => {
        throw new Error('should not fetch');
      });
      const resolvers = createDefaultResolvers(client, makeSecretsStub());
      const exa = findResolver(resolvers, 'exa');

      const outcome = await Effect.runPromise(
        exa.run(new URL('https://example.com/page')),
      );

      expect(outcome).toEqual(new ResolveDecline());
    } finally {
      if (originalKey === undefined) {
        delete process.env.EXA_API_KEY;
      } else {
        process.env.EXA_API_KEY = originalKey;
      }
    }
  });

  it('errors when the API call fails after a key is configured', async () => {
    const client = makeHttpClientStub(
      () => new Response('server error', { status: 500 }),
    );
    const resolvers = createDefaultResolvers(
      client,
      makeSecretsStub({ exa: 'test-key' }),
    );
    const exa = findResolver(resolvers, 'exa');

    const error = await Effect.runPromise(
      Effect.flip(exa.run(new URL('https://example.com/page'))),
    );

    expect(error._tag).toBe('ResolverError');
    expect(error.id).toBe('exa');
  });
});

describe('firecrawl', () => {
  it('declines when no API key is configured', async () => {
    const originalKey = process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    try {
      const client = makeHttpClientStub(() => {
        throw new Error('should not fetch');
      });
      const resolvers = createDefaultResolvers(client, makeSecretsStub());
      const firecrawl = findResolver(resolvers, 'firecrawl');

      const outcome = await Effect.runPromise(
        firecrawl.run(new URL('https://example.com/page')),
      );

      expect(outcome).toEqual(new ResolveDecline());
    } finally {
      if (originalKey === undefined) {
        delete process.env.FIRECRAWL_API_KEY;
      } else {
        process.env.FIRECRAWL_API_KEY = originalKey;
      }
    }
  });
});

describe('jina', () => {
  it('never declines — a transport failure is a ResolverError', async () => {
    const client = makeHttpClientStub(
      () => new Response('rate limited', { status: 429 }),
    );
    const resolvers = createDefaultResolvers(client, makeSecretsStub());
    const jina = findResolver(resolvers, 'jina');

    const error = await Effect.runPromise(
      Effect.flip(jina.run(new URL('https://example.com/page'))),
    );

    expect(error._tag).toBe('ResolverError');
    expect(error.id).toBe('jina');
  });

  it('succeeds with the response body', async () => {
    const client = makeHttpClientStub(
      () => new Response('# via jina', { status: 200 }),
    );
    const resolvers = createDefaultResolvers(client, makeSecretsStub());
    const jina = findResolver(resolvers, 'jina');

    const outcome = await Effect.runPromise(
      jina.run(new URL('https://example.com/page')),
    );

    expect(outcome).toEqual(new ResolveSuccess({ markdown: '# via jina' }));
  });
});
