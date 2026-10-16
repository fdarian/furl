import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';

import { FetchError, NoProviderKey, ResolverError } from '../../errors.ts';

import { runResolvers } from '../engine.ts';
import {
  makeHttpClientStub,
  makeResolverStub,
  makeSecretsStub,
} from '../test-doubles.ts';
import { ResolveDecline, ResolveSuccess } from '../types.ts';

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
  it('declines a URL without a file extension without fetching', async () => {
    const client = makeHttpClientStub(() => {
      throw new Error('should not fetch');
    });
    const raw = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'raw',
    );

    const outcome = await Effect.runPromise(
      raw.run(new URL('https://example.com/page')),
    );

    expect(outcome).toEqual(new ResolveDecline());
  });

  it('succeeds with the raw body for a file-extension URL', async () => {
    const client = makeHttpClientStub(
      () => new Response('# raw body', { status: 200 }),
    );
    const raw = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'raw',
    );

    const outcome = await Effect.runPromise(
      raw.run(new URL('https://example.com/file.md')),
    );

    expect(outcome).toEqual(new ResolveSuccess({ markdown: '# raw body' }));
  });

  it('fails with a ResolverError when a file-extension fetch fails', async () => {
    const client = makeHttpClientStub(
      () => new Response('not found', { status: 404 }),
    );
    const raw = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'raw',
    );

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
    const raw = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'raw',
    );
    const fallback = makeResolverStub({
      id: 'fallback',
      run: () => Effect.succeed(new ResolveSuccess({ markdown: '# fallback' })),
    });

    const result = await Effect.runPromise(
      runResolvers(new URL('https://example.com/page.html'), [raw, fallback]),
    );

    expect(result).toEqual({
      markdown: '# fallback',
      source: 'plugin:fallback',
    });
  });

  it('reports a failed raw fetch in AllResolversFailed when nothing else succeeds', async () => {
    const client = makeHttpClientStub(
      () => new Response('not found', { status: 404 }),
    );
    const raw = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'raw',
    );

    const error = await Effect.runPromise(
      Effect.flip(
        runResolvers(new URL('https://example.com/report.pdf'), [raw]),
      ),
    );

    expect(error._tag).toBe('AllResolversFailed');
    expect(error.message).toContain('default:raw');
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
    const raw = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'raw',
    );

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
    const raw = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'raw',
    );

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
    const direct = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'direct',
    );

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
    const direct = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'direct',
    );

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
    const direct = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'direct',
    );

    const outcome = await Effect.runPromise(
      direct.run(new URL('https://example.com/page')),
    );

    expect(outcome).toEqual(new ResolveDecline());
  });

  it('fails with a ResolverError on a transport failure', async () => {
    const client = makeHttpClientStub(() => {
      throw new Error('network down');
    });
    const direct = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'direct',
    );

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
    const direct = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'direct',
    );

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
    const mdSuffix = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'md-suffix',
    );

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
    const mdSuffix = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'md-suffix',
    );

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
    const mdSuffix = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'md-suffix',
    );

    const outcome = await Effect.runPromise(
      mdSuffix.run(new URL('https://example.com/page')),
    );

    expect(outcome).toEqual(new ResolveDecline());
  });
});

describe('provider resolvers', () => {
  it('wraps a missing Exa key without making an API request', async () => {
    const originalKey = process.env.EXA_API_KEY;
    delete process.env.EXA_API_KEY;
    try {
      const client = makeHttpClientStub(() => {
        throw new Error('should not fetch');
      });
      const exa = findResolver(
        createDefaultResolvers(client, makeSecretsStub()),
        'exa',
      );

      const error = await Effect.runPromise(
        Effect.flip(exa.run(new URL('https://example.com/page'))),
      );

      expect(error._tag).toBe('ResolverError');
      expect(error.cause).toBeInstanceOf(NoProviderKey);
    } finally {
      if (originalKey === undefined) {
        delete process.env.EXA_API_KEY;
      } else {
        process.env.EXA_API_KEY = originalKey;
      }
    }
  });

  it('wraps an Exa API failure as a ResolverError', async () => {
    const client = makeHttpClientStub(
      () => new Response('server error', { status: 500 }),
    );
    const exa = findResolver(
      createDefaultResolvers(client, makeSecretsStub({ exa: 'test-key' })),
      'exa',
    );

    const error = await Effect.runPromise(
      Effect.flip(exa.run(new URL('https://example.com/page'))),
    );

    expect(error).toBeInstanceOf(ResolverError);
    expect(error).toMatchObject({ id: 'exa' });
  });

  it('wraps a missing Firecrawl key without making an API request', async () => {
    const originalKey = process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    try {
      const client = makeHttpClientStub(() => {
        throw new Error('should not fetch');
      });
      const firecrawl = findResolver(
        createDefaultResolvers(client, makeSecretsStub()),
        'firecrawl',
      );

      const error = await Effect.runPromise(
        Effect.flip(firecrawl.run(new URL('https://example.com/page'))),
      );

      expect(error._tag).toBe('ResolverError');
      expect(error.cause).toBeInstanceOf(NoProviderKey);
    } finally {
      if (originalKey === undefined) {
        delete process.env.FIRECRAWL_API_KEY;
      } else {
        process.env.FIRECRAWL_API_KEY = originalKey;
      }
    }
  });

  it('reports Jina HTTP failures as ResolverError', async () => {
    const client = makeHttpClientStub(
      () => new Response('rate limited', { status: 429 }),
    );
    const jina = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'jina',
    );

    const error = await Effect.runPromise(
      Effect.flip(jina.run(new URL('https://example.com/page'))),
    );

    expect(error).toBeInstanceOf(ResolverError);
    expect(error).toMatchObject({ id: 'jina' });
  });

  it('succeeds with the Jina response body', async () => {
    const client = makeHttpClientStub(
      () => new Response('# via jina', { status: 200 }),
    );
    const jina = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'jina',
    );

    const outcome = await Effect.runPromise(
      jina.run(new URL('https://example.com/page')),
    );

    expect(outcome).toEqual(new ResolveSuccess({ markdown: '# via jina' }));
  });
});
