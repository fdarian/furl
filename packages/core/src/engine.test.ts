import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { HttpClient } from 'effect/http';
import { matchesUrl, runResolvers } from './engine.ts';
import { AllResolversFailed, ConfigError, ResolverError } from './errors.ts';
import { ResolveDecline, type Resolver, ResolveSuccess } from './resolver.ts';
import { makeHttpClientStub, makeResolverStub } from './test-doubles.ts';

const runWithClient = (url: URL, resolvers: readonly Resolver[]) =>
  runResolvers(url, resolvers).pipe(
    Effect.provideService(
      HttpClient.HttpClient,
      makeHttpClientStub(() => new Response('')),
    ),
  );

const runFail = <A, E>(effect: Effect.Effect<A, E>): Promise<E> =>
  Effect.runPromise(Effect.flip(effect));

const asAllResolversFailed = (
  error: AllResolversFailed | ConfigError,
): AllResolversFailed => {
  if (!(error instanceof AllResolversFailed)) {
    throw new Error(`expected AllResolversFailed, got ${error._tag}`);
  }
  return error;
};

describe('runResolvers', () => {
  const url = new URL('https://example.com/page');

  it('moves on to the next resolver when one declines', async () => {
    const first = makeResolverStub({
      id: 'first',
      run: () => Effect.succeed(new ResolveDecline()),
    });
    const second = makeResolverStub({
      id: 'second',
      run: () => Effect.succeed(new ResolveSuccess({ markdown: '# ok' })),
    });

    const result = await Effect.runPromise(runWithClient(url, [first, second]));

    expect(result).toEqual({ markdown: '# ok', source: 'second' });
  });

  it('short-circuits on the first success without running later resolvers', async () => {
    let laterRan = false;
    const first = makeResolverStub({
      id: 'first',
      run: () => Effect.succeed(new ResolveSuccess({ markdown: '# first' })),
    });
    const second = makeResolverStub({
      id: 'second',
      run: () => {
        laterRan = true;
        return Effect.succeed(new ResolveSuccess({ markdown: '# second' }));
      },
    });

    const result = await Effect.runPromise(runWithClient(url, [first, second]));

    expect(result).toEqual({ markdown: '# first', source: 'first' });
    expect(laterRan).toBe(false);
  });

  it('aborts the chain on a ConfigError without running later resolvers', async () => {
    let laterRan = false;
    const configError = new ConfigError({ cause: new Error('missing secret') });
    const first = makeResolverStub({
      id: 'first',
      run: () => Effect.fail(configError),
    });
    const second = makeResolverStub({
      id: 'second',
      run: () => {
        laterRan = true;
        return Effect.succeed(new ResolveSuccess({ markdown: '# second' }));
      },
    });

    const error = await runFail(runWithClient(url, [first, second]));

    expect(error).toBe(configError);
    expect(laterRan).toBe(false);
  });

  it('records a ResolverError and continues the chain', async () => {
    const first = makeResolverStub({
      id: 'jina',
      run: () =>
        Effect.fail(
          new ResolverError({ id: 'jina', cause: new Error('rate limited') }),
        ),
    });
    const second = makeResolverStub({
      id: 'exa',
      run: () => Effect.succeed(new ResolveSuccess({ markdown: '# via exa' })),
    });

    const result = await Effect.runPromise(runWithClient(url, [first, second]));

    expect(result).toEqual({ markdown: '# via exa', source: 'exa' });
  });

  it('aggregates resolver causes when nothing succeeds', async () => {
    const first = makeResolverStub({
      id: 'jina',
      run: () =>
        Effect.fail(
          new ResolverError({ id: 'jina', cause: new Error('no key') }),
        ),
    });
    const second = makeResolverStub({
      id: 'exa',
      run: () =>
        Effect.fail(
          new ResolverError({ id: 'exa', cause: new Error('rate limited') }),
        ),
    });
    const third = makeResolverStub({
      id: 'firecrawl',
      run: () => Effect.succeed(new ResolveDecline()),
    });

    const error = asAllResolversFailed(
      await runFail(runWithClient(url, [first, second, third])),
    );

    expect(error.failures.map((failure) => failure.id)).toEqual([
      'jina',
      'exa',
    ]);
    expect(String(error.failures[0]?.cause)).toContain('no key');
    expect(String(error.failures[1]?.cause)).toContain('rate limited');
  });

  it('redacts userinfo from AllResolversFailed', async () => {
    const credentialedUrl = new URL('https://user:pass@example.com/page');
    const resolver = makeResolverStub({
      id: 'first',
      run: () => Effect.succeed(new ResolveDecline()),
    });

    const error = asAllResolversFailed(
      await runFail(runWithClient(credentialedUrl, [resolver])),
    );

    expect(error.url).toBe('https://[redacted]@example.com/page');
    expect(error.url).not.toContain('user');
    expect(error.url).not.toContain('pass');
  });

  it('leaves a URL without userinfo untouched', async () => {
    const resolver = makeResolverStub({
      id: 'first',
      run: () => Effect.succeed(new ResolveDecline()),
    });

    const error = asAllResolversFailed(
      await runFail(runWithClient(url, [resolver])),
    );

    expect(error.url).toBe('https://example.com/page');
  });

  it('skips a resolver whose match fails without running it', async () => {
    let skippedRan = false;
    const skipped = makeResolverStub({
      id: 'other-host',
      match: { hostname: 'other.example' },
      run: () => {
        skippedRan = true;
        return Effect.succeed(new ResolveSuccess({ markdown: '# skipped' }));
      },
    });
    const matching = makeResolverStub({
      id: 'this-host',
      match: { hostname: 'example.com', path: '/*' },
      run: () => Effect.succeed(new ResolveSuccess({ markdown: '# ok' })),
    });

    const result = await Effect.runPromise(
      runWithClient(url, [skipped, matching]),
    );

    expect(result).toEqual({ markdown: '# ok', source: 'this-host' });
    expect(skippedRan).toBe(false);
  });

  it('does not record a skipped resolver as a failure', async () => {
    const skipped = makeResolverStub({
      id: 'other-host',
      match: { hostname: 'other.example' },
    });

    const error = asAllResolversFailed(
      await runFail(runWithClient(url, [skipped])),
    );

    expect(error.failures).toEqual([]);
  });

  it('matches path patterns segment by segment', () => {
    const match = { hostname: 'example.com', path: '/docs/*' };

    expect(matchesUrl(match, new URL('https://example.com/docs/intro'))).toBe(
      true,
    );
    expect(matchesUrl(match, new URL('https://example.com/docs'))).toBe(false);
    expect(matchesUrl(match, new URL('https://example.com/docs/a/b'))).toBe(
      false,
    );
    expect(matchesUrl(null, new URL('https://anything.example/'))).toBe(true);
  });

  it('matches a host with one-segment wildcards', () => {
    const tweet = new URL('https://x.com/someone/status/123');

    expect(matchesUrl({ hostname: 'x.com', path: '/*/status/*' }, tweet)).toBe(
      true,
    );
    expect(matchesUrl({ hostname: 'x.com' }, tweet)).toBe(true);
    expect(matchesUrl({ hostname: 'other.com' }, tweet)).toBe(false);
  });
});
