import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BunFileSystem } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';

import { FurlConfigService, FurlConfigServiceLive } from './config-service.ts';

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

  it('resolveOrder defaults to ["*", "default:*"] when config.json is absent', async () => {
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

  it('read tolerates a config.json with no plugin-system keys (legacy shape)', async () => {
    writeConfig({ provider: 'exa' });

    const config = await runWithConfig(
      Effect.gen(function* () {
        const service = yield* FurlConfigService;
        return yield* service.read;
      }),
    );

    expect(config).toEqual({ provider: 'exa' });
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
