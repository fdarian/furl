import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BunFileSystem } from '@effect/platform-bun';
import { Effect, FileSystem } from 'effect';

import { loadPluginManifest } from './discovery.ts';
import type { PluginLoaderShape } from './loader.ts';

/**
 * Exercises `loadPluginManifest` (entrypoint resolution + manifest
 * validation) against real, disposable folders on disk — offline, and
 * with a stub `PluginLoader` so no dynamic import / Bun virtual module is
 * needed.
 */

const makeLoaderStub = (
  manifestByEntrypoint: Readonly<Record<string, unknown>>,
): PluginLoaderShape => ({
  load: (entrypointPath) =>
    Effect.succeed(manifestByEntrypoint[entrypointPath]),
});

const validManifest = (name: string) => ({
  name: name,
  match: { hostname: `${name}.example.com` },
  resolve: () => null,
});

const runWithFileSystem = <A, E>(
  build: (fileSystem: FileSystem.FileSystem) => Effect.Effect<A, E>,
): Promise<A> =>
  Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        return yield* build(fileSystem);
      }),
      BunFileSystem.layer,
    ),
  );

describe('loadPluginManifest', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'furl-plugin-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves index.ts as the default entrypoint and loads a valid manifest', async () => {
    const folder = path.join(tempDir, 'x');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'index.ts'), '');
    const entrypoint = path.join(folder, 'index.ts');
    const loader = makeLoaderStub({ [entrypoint]: validManifest('x') });

    const plugin = await runWithFileSystem((fileSystem) =>
      loadPluginManifest(fileSystem, loader, folder),
    );

    expect(plugin.name).toBe('x');
    expect(plugin.entrypoint).toBe(entrypoint);
    expect(plugin.folder).toBe(folder);
  });

  it('falls back to package.json#main when index.ts is absent', async () => {
    const folder = path.join(tempDir, 'y');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
      path.join(folder, 'package.json'),
      JSON.stringify({ main: 'dist/entry.js' }),
    );
    const entrypoint = path.join(folder, 'dist/entry.js');
    const loader = makeLoaderStub({ [entrypoint]: validManifest('y') });

    const plugin = await runWithFileSystem((fileSystem) =>
      loadPluginManifest(fileSystem, loader, folder),
    );

    expect(plugin.entrypoint).toBe(entrypoint);
  });

  it('fails when neither index.ts nor package.json exists', async () => {
    const folder = path.join(tempDir, 'empty');
    fs.mkdirSync(folder, { recursive: true });
    const loader = makeLoaderStub({});

    const error = await runWithFileSystem((fileSystem) =>
      Effect.flip(loadPluginManifest(fileSystem, loader, folder)),
    );

    expect(error._tag).toBe('PluginLoadError');
  });

  it('rejects a manifest name of "*"', async () => {
    const folder = path.join(tempDir, 'reserved-star');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'index.ts'), '');
    const entrypoint = path.join(folder, 'index.ts');
    const loader = makeLoaderStub({
      [entrypoint]: { ...validManifest('placeholder'), name: '*' },
    });

    const error = await runWithFileSystem((fileSystem) =>
      Effect.flip(loadPluginManifest(fileSystem, loader, folder)),
    );

    expect(error._tag).toBe('PluginLoadError');
    expect(String(error.cause)).toContain('reserved');
  });

  it('rejects a manifest name starting with "default:"', async () => {
    const folder = path.join(tempDir, 'reserved-default');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'index.ts'), '');
    const entrypoint = path.join(folder, 'index.ts');
    const loader = makeLoaderStub({
      [entrypoint]: { ...validManifest('placeholder'), name: 'default:jina' },
    });

    const error = await runWithFileSystem((fileSystem) =>
      Effect.flip(loadPluginManifest(fileSystem, loader, folder)),
    );

    expect(error._tag).toBe('PluginLoadError');
    expect(String(error.cause)).toContain('reserved');
  });

  it('rejects a manifest missing a valid match.hostname', async () => {
    const folder = path.join(tempDir, 'no-match');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'index.ts'), '');
    const entrypoint = path.join(folder, 'index.ts');
    const loader = makeLoaderStub({
      [entrypoint]: { name: 'x', resolve: () => null },
    });

    const error = await runWithFileSystem((fileSystem) =>
      Effect.flip(loadPluginManifest(fileSystem, loader, folder)),
    );

    expect(error._tag).toBe('PluginLoadError');
    expect(String(error.cause)).toContain('match.hostname');
  });
});
