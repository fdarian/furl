import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';

import { AllResolversFailed, ResolverError } from '../errors.ts';

import { runResolvers } from './engine.ts';
import { makeResolverStub } from './test-doubles.ts';
import { ResolveDecline, ResolveFailure, ResolveSuccess } from './types.ts';

/**
 * Exercises `runResolvers`'s chain semantics directly, with `Resolver`
 * stubs standing in for both built-ins and plugins — nothing here touches
 * the network or the filesystem.
 */

const runFail = <A, E>(effect: Effect.Effect<A, E>): Promise<E> =>
  Effect.runPromise(Effect.flip(effect));

/** Narrows `runResolvers`'s error union for tests that inspect `AllResolversFailed`-only fields. */
const asAllResolversFailed = (
  error: AllResolversFailed | ResolverError,
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

    const result = await Effect.runPromise(runResolvers(url, [first, second]));

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

    const result = await Effect.runPromise(runResolvers(url, [first, second]));

    expect(result).toEqual({ markdown: '# first', source: 'first' });
    expect(laterRan).toBe(false);
  });

  it('aborts the chain on a terminal ResolveFailure, surfacing its own cause', async () => {
    let laterRan = false;
    const terminalError = new ResolverError({
      id: 'raw',
      cause: new Error('404'),
    });
    const first = makeResolverStub({
      id: 'raw',
      run: () => Effect.succeed(new ResolveFailure({ error: terminalError })),
    });
    const second = makeResolverStub({
      id: 'second',
      run: () => {
        laterRan = true;
        return Effect.succeed(new ResolveSuccess({ markdown: '# second' }));
      },
    });

    const error = await runFail(runResolvers(url, [first, second]));

    expect(error).toBe(terminalError);
    expect(laterRan).toBe(false);
  });

  it('records a non-terminal ResolverError and continues the chain instead of aborting', async () => {
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

    const result = await Effect.runPromise(runResolvers(url, [first, second]));

    expect(result).toEqual({ markdown: '# via exa', source: 'exa' });
  });

  it('aggregates every resolver cause into AllResolversFailed when nothing succeeds', async () => {
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
      await runFail(runResolvers(url, [first, second, third])),
    );

    expect(error.failures.map((failure) => failure.id)).toEqual([
      'jina',
      'exa',
    ]);
    expect(String(error.failures[0]?.cause)).toContain('no key');
    expect(String(error.failures[1]?.cause)).toContain('rate limited');
  });

  it('redacts userinfo from the URL carried by AllResolversFailed', async () => {
    const credentialedUrl = new URL('https://user:pass@example.com/page');
    const resolver = makeResolverStub({
      id: 'first',
      run: () => Effect.succeed(new ResolveDecline()),
    });

    const error = asAllResolversFailed(
      await runFail(runResolvers(credentialedUrl, [resolver])),
    );

    expect(error.url).toBe('https://example.com/page');
    expect(error.url).not.toContain('user');
    expect(error.url).not.toContain('pass');
  });

  it('leaves a URL without userinfo untouched', async () => {
    const resolver = makeResolverStub({
      id: 'first',
      run: () => Effect.succeed(new ResolveDecline()),
    });

    const error = asAllResolversFailed(
      await runFail(runResolvers(url, [resolver])),
    );

    expect(error.url).toBe('https://example.com/page');
  });
});
