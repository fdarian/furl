import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';

import { makeHttpClientStub, makeSecretsStub } from '../test-doubles.ts';

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

    expect(outcome).toEqual({ _tag: 'decline' });
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

    expect(outcome).toEqual({ _tag: 'success', markdown: '# raw body' });
  });

  it('errors when the fetch fails', async () => {
    const client = makeHttpClientStub(
      () => new Response('nope', { status: 500 }),
    );
    const resolvers = createDefaultResolvers(client, makeSecretsStub());
    const raw = findResolver(resolvers, 'raw');

    const error = await Effect.runPromise(
      Effect.flip(raw.run(new URL('https://example.com/file.md'))),
    );

    expect(error._tag).toBe('ResolverError');
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
    const resolvers = createDefaultResolvers(client, makeSecretsStub());
    const direct = findResolver(resolvers, 'direct');

    const outcome = await Effect.runPromise(
      direct.run(new URL('https://example.com/page')),
    );

    expect(outcome).toEqual({ _tag: 'decline' });
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

    expect(outcome).toEqual({ _tag: 'success', markdown: '# hello' });
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

    expect(outcome).toEqual({ _tag: 'decline' });
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

    expect(outcome).toEqual({ _tag: 'success', markdown: '# suffixed' });
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

      expect(outcome).toEqual({ _tag: 'decline' });
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

      expect(outcome).toEqual({ _tag: 'decline' });
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

    expect(outcome).toEqual({ _tag: 'success', markdown: '# via jina' });
  });
});
