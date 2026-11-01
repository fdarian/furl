import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { HttpClient } from 'effect/http';

import { ConfigError } from './errors.ts';
import { Furl } from './furl.ts';
import { ResolveSuccess } from './resolver.ts';
import { Resolvers } from './resolvers.ts';
import { makeHttpClientStub, makeResolverStub } from './test-doubles.ts';

const succeedWith = (id: string, markdown: string) =>
  makeResolverStub({
    id: id,
    run: () => Effect.succeed(new ResolveSuccess({ markdown: markdown })),
  });

const withClient =
  (body: string) =>
  <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
    Effect.provideService(
      effect,
      HttpClient.HttpClient,
      makeHttpClientStub(() => new Response(body, { status: 200 })),
    );

describe('Furl.fetch', () => {
  it('runs Resolvers.defaults with no layer, through the caller client', async () => {
    const result = await Effect.runPromise(
      Furl.fetch('https://example.com/file.md').pipe(withClient('# hi')),
    );

    expect(result).toEqual({ markdown: '# hi', source: 'raw' });
  });

  it('uses the HttpClient provided at call time, not an earlier one', async () => {
    const program = Furl.fetch('https://example.com/file.md');

    const first = await Effect.runPromise(program.pipe(withClient('# one')));
    const second = await Effect.runPromise(program.pipe(withClient('# two')));

    expect(first.markdown).toBe('# one');
    expect(second.markdown).toBe('# two');
  });

  it('uses the caller client even when a layer sets the resolvers', async () => {
    const result = await Effect.runPromise(
      Furl.fetch('https://example.com/file.md').pipe(
        Effect.provide(Furl.layer({ resolvers: [Resolvers.raw] })),
        withClient('# caller'),
      ),
    );

    expect(result).toEqual({ markdown: '# caller', source: 'raw' });
  });

  it('does not compile without an HttpClient', () => {
    const run = () =>
      // @ts-expect-error Furl.fetch requires HttpClient.HttpClient
      Effect.runPromise(Furl.fetch('https://example.com/file.md'));

    expect(run).toBeInstanceOf(Function);
  });

  it('fails with FetchError for an invalid URL', async () => {
    const error = await Effect.runPromise(
      Effect.flip(Furl.fetch('not a url').pipe(withClient('# hi'))),
    );

    expect(error._tag).toBe('FetchError');
  });

  it('aborts the chain on a ConfigError', async () => {
    const aborting = makeResolverStub({
      id: 'aborting',
      run: () => Effect.fail(new ConfigError({ cause: new Error('bad') })),
    });

    const error = await Effect.runPromise(
      Effect.flip(
        Furl.fetch('https://example.com/page', {
          resolvers: [aborting, succeedWith('later', '# later')],
        }).pipe(withClient('# hi')),
      ),
    );

    expect(error._tag).toBe('ConfigError');
  });
});

describe('Furl resolvers', () => {
  it('defaults to Resolvers.defaults', async () => {
    const resolvers = await Effect.runPromise(Furl);

    expect(resolvers).toBe(Resolvers.defaults);
  });

  it('is set by the layer, which requires nothing', async () => {
    const list = [
      succeedWith('first', '# first'),
      succeedWith('second', '# 2'),
    ];

    const result = await Effect.runPromise(
      Furl.fetch('https://example.com/page').pipe(
        Effect.provide(Furl.layer({ resolvers: list })),
        withClient('# unused'),
      ),
    );

    expect(result).toEqual({ markdown: '# first', source: 'first' });
  });

  it('falls back to Resolvers.defaults for a layer without resolvers', async () => {
    const resolvers = await Effect.runPromise(
      Furl.pipe(Effect.provide(Furl.layer())),
    );

    expect(resolvers).toBe(Resolvers.defaults);
  });

  it('is replaced by the per-call list', async () => {
    const layer = Furl.layer({ resolvers: [succeedWith('layer', '# layer')] });

    const result = await Effect.runPromise(
      Furl.fetch('https://example.com/page', {
        resolvers: [succeedWith('call', '# call')],
      }).pipe(Effect.provide(layer), withClient('# unused')),
    );

    expect(result).toEqual({ markdown: '# call', source: 'call' });
  });

  it('is replaced by the per-call list when there is no layer', async () => {
    const result = await Effect.runPromise(
      Furl.fetch('https://example.com/page', {
        resolvers: [succeedWith('call', '# call')],
      }).pipe(withClient('# unused')),
    );

    expect(result).toEqual({ markdown: '# call', source: 'call' });
  });

  it('fails with AllResolversFailed for an empty list', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        Furl.fetch('https://example.com/page', { resolvers: [] }).pipe(
          withClient('# unused'),
        ),
      ),
    );

    expect(error._tag).toBe('AllResolversFailed');
  });
});
