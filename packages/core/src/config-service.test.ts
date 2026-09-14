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

  it('defaults order to the keyless built-ins', async () => {
    const order = await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        return yield* config.resolveOrder;
      }),
    );

    expect(order).toEqual(['default:*']);
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

  it('migrates a legacy provider field into the effective order on read', async () => {
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
      value: { order: ['default:*', 'default:exa'] },
      provider: 'exa',
      order: ['default:*', 'default:exa'],
    });
  });

  it('lets an explicit order win over a legacy provider field', async () => {
    writeConfig({ provider: 'exa', order: ['default:jina'] });

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
      value: { order: ['default:jina'] },
      provider: 'jina',
      order: ['default:jina'],
    });
  });

  it('uses the first provider token in an explicit order for the provider label', async () => {
    writeConfig({ order: ['default:firecrawl', 'default:jina'] });

    const provider = await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        return yield* config.resolveProvider(Option.none());
      }),
    );

    expect(provider).toBe('firecrawl');
  });

  it('falls back to jina as the provider label without enabling it', async () => {
    const provider = await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        return yield* config.resolveProvider(Option.none());
      }),
    );

    expect(provider).toBe('jina');
  });

  it('writes a canonical order and drops a legacy provider field', async () => {
    await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        yield* config.write({ provider: 'exa' });
      }),
    );

    const written = fs.readFileSync(
      path.join(tempHome, '.config/furl/config.json'),
      'utf8',
    );
    expect(written).toContain('"default:*"');
    expect(written).toContain('"default:exa"');
    expect(written).not.toContain('"provider"');
  });

  it('keeps an explicit order when writing a config that also has provider', async () => {
    await runWithConfig(
      Effect.gen(function* () {
        const config = yield* FurlConfigService;
        yield* config.write({
          provider: 'exa',
          order: ['default:jina'],
          plugins: { alpha: { mode: 'full' } },
        });
      }),
    );

    const written = fs.readFileSync(
      path.join(tempHome, '.config/furl/config.json'),
      'utf8',
    );
    expect(written).toContain('"default:jina"');
    expect(written).toContain('"alpha"');
    expect(written).not.toContain('"default:exa"');
    expect(written).not.toContain('"provider"');
  });
});

describe('insertProviderToken', () => {
  it('starts a missing order with the keyless wildcard before the provider', () => {
    expect(insertProviderToken(['default:*'], 'exa')).toEqual([
      'default:*',
      'default:exa',
    ]);
  });

  it('moves an existing provider ahead of other providers without duplicating it', () => {
    expect(
      insertProviderToken(['default:*', 'default:jina', 'default:exa'], 'exa'),
    ).toEqual(['default:*', 'default:exa', 'default:jina']);
  });

  it('preserves unrelated order entries while inserting after free probes', () => {
    expect(
      insertProviderToken(['default:*', 'plugin:alpha'], 'firecrawl'),
    ).toEqual(['default:*', 'default:firecrawl', 'plugin:alpha']);
  });
});
