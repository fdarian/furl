import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';

import { NoProviderKey, ResolverError } from '../../errors.ts';

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

  it('returns a terminal failure when a file-extension fetch fails', async () => {
    const client = makeHttpClientStub(
      () => new Response('not found', { status: 404 }),
    );
    const raw = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'raw',
    );

    const outcome = await Effect.runPromise(
      raw.run(new URL('https://example.com/report.pdf')),
    );

    expect(outcome).toBeInstanceOf(ResolveFailure);
  });

  it('keeps a failed web-page extension terminal, matching the existing fetch path', async () => {
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

    const error = await Effect.runPromise(
      Effect.flip(
        runResolvers(new URL('https://example.com/page.html'), [raw, fallback]),
      ),
    );

    expect(error).toBeInstanceOf(ResolverError);
    if (!(error instanceof ResolverError)) {
      throw new Error(`expected ResolverError, got ${error._tag}`);
    }
    expect(error.id).toBe('raw');
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

  it('declines on a transport failure', async () => {
    const client = makeHttpClientStub(() => {
      throw new Error('network down');
    });
    const direct = findResolver(
      createDefaultResolvers(client, makeSecretsStub()),
      'direct',
    );

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

    expect(error._tag).toBe('ResolverError');
    expect(error.id).toBe('exa');
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

    expect(error._tag).toBe('ResolverError');
    expect(error.id).toBe('jina');
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
