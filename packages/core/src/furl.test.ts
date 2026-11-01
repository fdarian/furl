import { describe, expect, it } from 'bun:test';
import { Effect, Layer } from 'effect';
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

const makeLayer = (options?: Parameters<typeof Furl.layer>[0]) =>
  Furl.layer(options).pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        makeHttpClientStub(() => new Response('# hi', { status: 200 })),
      ),
    ),
  );

describe('Furl', () => {
  it('uses Resolvers.defaults when the layer has no resolvers', async () => {
    const result = await Effect.runPromise(
      Furl.fetch('https://example.com/file.md').pipe(
        Effect.provide(makeLayer()),
      ),
    );

    expect(result).toEqual({ markdown: '# hi', source: 'raw' });
  });

  it('runs the layer resolvers in order and reports the winning id', async () => {
    const layer = makeLayer({
      resolvers: [
        succeedWith('first', '# first'),
        succeedWith('second', '# 2'),
      ],
    });

    const result = await Effect.runPromise(
      Furl.fetch('https://example.com/page').pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({ markdown: '# first', source: 'first' });
  });

  it('replaces the layer resolvers with the per-call list', async () => {
    const layer = makeLayer({ resolvers: [succeedWith('layer', '# layer')] });

    const result = await Effect.runPromise(
      Furl.fetch('https://example.com/page', {
        resolvers: [succeedWith('call', '# call')],
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({ markdown: '# call', source: 'call' });
  });

  it('is the same as calling fetch on the service instance', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const furl = yield* Furl;
        return yield* furl.fetch('https://example.com/file.md');
      }).pipe(Effect.provide(makeLayer({ resolvers: [Resolvers.raw] }))),
    );

    expect(result.source).toBe('raw');
  });

  it('fails with AllResolversFailed for an empty resolver list', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        Furl.fetch('https://example.com/page', { resolvers: [] }).pipe(
          Effect.provide(makeLayer()),
        ),
      ),
    );

    expect(error._tag).toBe('AllResolversFailed');
  });

  it('fails with FetchError for an invalid URL', async () => {
    const error = await Effect.runPromise(
      Effect.flip(Furl.fetch('not a url').pipe(Effect.provide(makeLayer()))),
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
        }).pipe(Effect.provide(makeLayer())),
      ),
    );

    expect(error._tag).toBe('ConfigError');
  });
});
