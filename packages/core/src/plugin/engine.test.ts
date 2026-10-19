import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';

import { AllResolversFailed, ConfigError, ResolverError } from '../errors.ts';

import { runResolvers } from './engine.ts';
import { makeResolverStub } from './test-doubles.ts';
import { ResolveDecline, ResolveSuccess } from './types.ts';

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

    const result = await Effect.runPromise(runResolvers(url, [first, second]));

    expect(result).toEqual({ markdown: '# ok', source: 'plugin:second' });
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

    expect(result).toEqual({ markdown: '# first', source: 'plugin:first' });
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

    const error = await runFail(runResolvers(url, [first, second]));

    expect(error).toBe(configError);
    expect(laterRan).toBe(false);
  });

  it('records a ResolverError and continues the chain', async () => {
    const first = makeResolverStub({
      id: 'jina',
      isDefault: true,
      run: () =>
        Effect.fail(
          new ResolverError({ id: 'jina', cause: new Error('rate limited') }),
        ),
    });
    const second = makeResolverStub({
      id: 'exa',
      isDefault: true,
      run: () => Effect.succeed(new ResolveSuccess({ markdown: '# via exa' })),
    });

    const result = await Effect.runPromise(runResolvers(url, [first, second]));

    expect(result).toEqual({ markdown: '# via exa', source: 'default:exa' });
  });

  it('aggregates resolver causes when nothing succeeds', async () => {
    const first = makeResolverStub({
      id: 'jina',
      isDefault: true,
      run: () =>
        Effect.fail(
          new ResolverError({ id: 'jina', cause: new Error('no key') }),
        ),
    });
    const second = makeResolverStub({
      id: 'exa',
      isDefault: true,
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
      'default:jina',
      'default:exa',
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
      await runFail(runResolvers(credentialedUrl, [resolver])),
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
      await runFail(runResolvers(url, [resolver])),
    );

    expect(error.url).toBe('https://example.com/page');
  });

  it('labels a plugin failure and a built-in of the same name by order token', async () => {
    const plugin = makeResolverStub({
      id: 'jina',
      run: () =>
        Effect.fail(
          new ResolverError({ id: 'jina', cause: new Error('plugin broke') }),
        ),
    });
    const builtin = makeResolverStub({
      id: 'jina',
      isDefault: true,
      run: () =>
        Effect.fail(
          new ResolverError({ id: 'jina', cause: new Error('builtin broke') }),
        ),
    });

    const error = asAllResolversFailed(
      await runFail(runResolvers(url, [plugin, builtin])),
    );

    expect(error.failures.map((failure) => failure.id)).toEqual([
      'plugin:jina',
      'default:jina',
    ]);
  });
});
