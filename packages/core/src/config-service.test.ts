import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BunFileSystem } from '@effect/platform-bun';
import { Effect, Layer, Option } from 'effect';

import {
  FurlConfigService,
  FurlConfigServiceLive,
  insertProviderToken,
} from './config-service.ts';

/**
 * Exercises `FurlConfigServiceLive` against a real, disposable `$HOME` on
 * disk (never the user's actual `~/.config/furl`) — offline and
 * network-free, using the real `FileSystem` service against a temp dir.
 */

const configLayer = FurlConfigServiceLive.pipe(
  Layer.provide(BunFileSystem.layer),
);

const runWithConfig = <A, E>(
  effect: Effect.Effect<A, E, FurlConfigService>,
): Promise<A> => Effect.runPromise(Effect.provide(effect, configLayer));

describe('FurlConfigService', () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'furl-config-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  const writeConfig = (config: unknown): void => {
    const configDirectory = path.join(tempHome, '.config/furl');
    fs.mkdirSync(configDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(configDirectory, 'config.json'),
      JSON.stringify(config),
    );
  };

  it('resolveOrder defaults to the keyless chain when config.json is absent', async () => {
    const order = await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        return yield* config.resolveOrder;
      }),
    );

    expect(order).toEqual([
      '*',
      'default:raw',
      'default:direct',
      'default:md-suffix',
    ]);
  });

  it('an explicit order of ["*", "default:*"] restores all six builtins', async () => {
    writeConfig({ order: ['*', 'default:*'] });

    const order = await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        return yield* config.resolveOrder;
      }),
    );

    expect(order).toEqual(['*', 'default:*']);
  });

  it('resolveOrder reads the configured order array', async () => {
    writeConfig({ order: ['x', '*', 'default:*'] });

    const order = await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        return yield* config.resolveOrder;
      }),
    );

    expect(order).toEqual(['x', '*', 'default:*']);
  });

  it('pluginArgs is undefined for a plugin absent from config', async () => {
    writeConfig({});

    const args = await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        return yield* config.pluginArgs('x');
      }),
    );

    expect(args).toBeUndefined();
  });

  it('pluginArgs returns the configured args object untouched', async () => {
    writeConfig({ plugins: { x: { apiKey: 'secret:x-api-key' } } });

    const args = await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        return yield* config.pluginArgs('x');
      }),
    );

    expect(args).toEqual({ apiKey: 'secret:x-api-key' });
  });

  it('isPluginDisabled is true only when the plugin value is exactly false', async () => {
    writeConfig({ plugins: { x: false, y: { mode: 'metadata' } } });

    const disabled = await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        return {
          x: yield* config.isPluginDisabled('x'),
          y: yield* config.isPluginDisabled('y'),
          z: yield* config.isPluginDisabled('z'),
        };
      }),
    );

    expect(disabled).toEqual({ x: true, y: false, z: false });
  });

  it('read migrates a legacy "provider" field into "order", appended after the free probes', async () => {
    writeConfig({ provider: 'exa' });

    const config = await runWithConfig(
      Effect.gen(function* () {
        const service = yield* FurlConfigService;
        return yield* service.read;
      }),
    );

    expect(config).toEqual({
      order: [
        '*',
        'default:raw',
        'default:direct',
        'default:md-suffix',
        'default:exa',
      ],
    });
  });

  it('read folds a legacy "provider" field into an existing custom "order" that lacks it', async () => {
    writeConfig({ provider: 'firecrawl', order: ['x', '*'] });

    const config = await runWithConfig(
      Effect.gen(function* () {
        const service = yield* FurlConfigService;
        return yield* service.read;
      }),
    );

    expect(config).toEqual({ order: ['x', '*', 'default:firecrawl'] });
  });

  it('read leaves "order" untouched when it already contains the legacy provider\'s token', async () => {
    writeConfig({ provider: 'exa', order: ['default:exa', '*'] });

    const config = await runWithConfig(
      Effect.gen(function* () {
        const service = yield* FurlConfigService;
        return yield* service.read;
      }),
    );

    expect(config).toEqual({ order: ['default:exa', '*'] });
  });

  it('resolveProvider returns the first provider token found in order', async () => {
    writeConfig({ order: ['default:firecrawl', 'default:jina'] });

    const provider = await runWithConfig(
      Effect.gen(function* () {
        const service = yield* FurlConfigService;
        return yield* service.resolveProvider(Option.none());
      }),
    );

    expect(provider).toBe('firecrawl');
  });

  it('resolveProvider falls back to "jina" when order has no provider token', async () => {
    const provider = await runWithConfig(
      Effect.gen(function* () {
        const service = yield* FurlConfigService;
        return yield* service.resolveProvider(Option.none());
      }),
    );

    expect(provider).toBe('jina');
  });

  it('resolveProvider picks up a provider token migrated from a legacy "provider" field', async () => {
    writeConfig({ provider: 'firecrawl' });

    const provider = await runWithConfig(
      Effect.gen(function* () {
        const service = yield* FurlConfigService;
        return yield* service.resolveProvider(Option.none());
      }),
    );

    expect(provider).toBe('firecrawl');
  });

  it('writing an inserted provider token (what `furl providers` now does) persists and round-trips', async () => {
    writeConfig({ order: ['*', 'default:raw'], plugins: { x: { key: 1 } } });

    const result = await runWithConfig(
      Effect.gen(function* () {
        const service = yield* FurlConfigService;
        const config = yield* service.read;
        const order = yield* service.resolveOrder;
        yield* service.write({
          order: insertProviderToken(order, 'firecrawl'),
          plugins: config.plugins,
        });
        return {
          order: yield* service.resolveOrder,
          provider: yield* service.resolveProvider(Option.none()),
          args: yield* service.pluginArgs('x'),
        };
      }),
    );

    expect(result).toEqual({
      order: ['*', 'default:raw', 'default:firecrawl'],
      provider: 'firecrawl',
      args: { key: 1 },
    });
  });

  it('read returns {} when config.json does not exist', async () => {
    const config = await runWithConfig(
      Effect.gen(function* () {
        const service = yield* FurlConfigService;
        return yield* service.read;
      }),
    );

    expect(config).toEqual({});
  });
});

describe('insertProviderToken', () => {
  it('places the provider after the free probes, not at the front of the chain', () => {
    // Pins the fix: a "default provider" must never outrank furl's free,
    // keyless probes — the previous prepend-to-front behavior would have
    // made every fetch pay for a provider call the probes could have
    // avoided.
    const order = insertProviderToken(
      ['*', 'default:raw', 'default:direct', 'default:md-suffix'],
      'firecrawl',
    );

    expect(order).toEqual([
      '*',
      'default:raw',
      'default:direct',
      'default:md-suffix',
      'default:firecrawl',
    ]);
  });

  it('places the new provider ahead of an existing provider token, both still after the free probes', () => {
    const order = insertProviderToken(
      [
        '*',
        'default:raw',
        'default:direct',
        'default:md-suffix',
        'default:jina',
      ],
      'firecrawl',
    );

    expect(order).toEqual([
      '*',
      'default:raw',
      'default:direct',
      'default:md-suffix',
      'default:firecrawl',
      'default:jina',
    ]);
  });

  it('moves an already-present token ahead of another provider instead of duplicating it', () => {
    const order = insertProviderToken(
      ['default:raw', 'default:jina', 'default:firecrawl'],
      'firecrawl',
    );

    expect(order).toEqual(['default:raw', 'default:firecrawl', 'default:jina']);
  });

  it('respects a hand-edited order lacking the free probes: inserts ahead of another provider token, otherwise unchanged', () => {
    const order = insertProviderToken(['default:jina', 'x', '*'], 'firecrawl');

    expect(order).toEqual(['default:firecrawl', 'default:jina', 'x', '*']);
  });

  it('appends when the order has neither a free probe nor another provider token', () => {
    const order = insertProviderToken(['x', '*'], 'firecrawl');

    expect(order).toEqual(['x', '*', 'default:firecrawl']);
  });
});
