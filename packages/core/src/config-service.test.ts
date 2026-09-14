import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BunFileSystem } from '@effect/platform-bun';
import { Effect, Layer, Option } from 'effect';

import { FurlConfigService, FurlConfigServiceLive } from './config-service.ts';

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

  it('defaults order to the legacy resolver chain', async () => {
    const order = await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        return yield* config.resolveOrder;
      }),
    );

    expect(order).toEqual([
      'default:raw',
      'default:direct',
      'default:md-suffix',
      'default:jina',
    ]);
  });

  it('reads an explicit order array unchanged', async () => {
    writeConfig({ order: ['plugin:alpha', 'default:jina'] });

    const order = await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        return yield* config.resolveOrder;
      }),
    );

    expect(order).toEqual(['plugin:alpha', 'default:jina']);
  });

  it('passes a configured plugin object through unchanged', async () => {
    writeConfig({ plugins: { alpha: { mode: 'full', value: 2 } } });

    const args = await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        return yield* config.pluginArgs('alpha');
      }),
    );

    expect(args).toEqual({ mode: 'full', value: 2 });
  });

  it('returns undefined for an absent plugin object', async () => {
    const args = await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        return yield* config.pluginArgs('alpha');
      }),
    );

    expect(args).toBeUndefined();
  });

  it('rejects false plugin values because order controls enablement', async () => {
    writeConfig({ plugins: { alpha: false } });

    const error = await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        return yield* Effect.flip(config.read);
      }),
    );

    expect(error._tag).toBe('ConfigError');
  });

  it('keeps a legacy provider field readable without migrating or writing it', async () => {
    writeConfig({ provider: 'exa' });

    const result = await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        return {
          value: yield* config.read,
          provider: yield* config.resolveProvider(Option.none()),
          order: yield* config.resolveOrder,
        };
      }),
    );

    expect(result).toEqual({
      value: { provider: 'exa' },
      provider: 'exa',
      order: [
        'default:raw',
        'default:direct',
        'default:md-suffix',
        'default:exa',
      ],
    });
  });

  it('uses the legacy default provider when no provider is configured', async () => {
    const provider = await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        return yield* config.resolveProvider(Option.none());
      }),
    );

    expect(provider).toBe('jina');
  });
});
