import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BunFileSystem } from '@effect/platform-bun';
import { Effect, FileSystem } from 'effect';

import { discoverPlugins, loadPluginManifest } from './discovery.ts';
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

  it('rejects a manifest name matching a built-in resolver id', async () => {
    const folder = path.join(tempDir, 'reserved-builtin');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'index.ts'), '');
    const entrypoint = path.join(folder, 'index.ts');
    const loader = makeLoaderStub({
      [entrypoint]: { ...validManifest('placeholder'), name: 'jina' },
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

  it('rejects a manifest with a non-string match.path', async () => {
    const folder = path.join(tempDir, 'bad-path');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'index.ts'), '');
    const entrypoint = path.join(folder, 'index.ts');
    const loader = makeLoaderStub({
      [entrypoint]: {
        ...validManifest('bad-path'),
        match: { hostname: 'bad-path.example.com', path: 123 },
      },
    });

    const error = await runWithFileSystem((fileSystem) =>
      Effect.flip(loadPluginManifest(fileSystem, loader, folder)),
    );

    expect(error._tag).toBe('PluginLoadError');
    expect(String(error.cause)).toContain('match.path');
  });
});

/**
 * Exercises `discoverPlugins`'s disabled-before-import skip: a real
 * `~/.config/furl/plugins` tree (`HOME` pointed at a disposable temp dir),
 * and a `PluginLoader` stub that records every entrypoint it's asked to
 * import — so a disabled folder never being imported is directly
 * observable, not just inferred from the returned plugin list.
 */
describe('discoverPlugins', () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'furl-home-test-'));
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

  const pluginsDir = () => path.join(tempHome, '.config', 'furl', 'plugins');

  const writePluginFolder = (
    folderName: string,
    options: { packageJsonName?: string } = {},
  ): string => {
    const folder = path.join(pluginsDir(), folderName);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'index.ts'), '');
    if (options.packageJsonName !== undefined) {
      fs.writeFileSync(
        path.join(folder, 'package.json'),
        JSON.stringify({ name: options.packageJsonName }),
      );
    }
    return folder;
  };

  const makeRecordingLoader = (
    manifestName: string,
  ): { loader: PluginLoaderShape; loaded: string[] } => {
    const loaded: string[] = [];
    return {
      loaded: loaded,
      loader: {
        load: (entrypointPath) => {
          loaded.push(entrypointPath);
          return Effect.succeed(validManifest(manifestName));
        },
      },
    };
  };

  it('imports and returns an enabled plugin', async () => {
    const folder = writePluginFolder('a');
    const { loader, loaded } = makeRecordingLoader('a');

    const plugins = await runWithFileSystem((fileSystem) =>
      discoverPlugins(fileSystem, loader, new Set()),
    );

    expect(plugins.map((plugin) => plugin.name)).toEqual(['a']);
    expect(loaded).toEqual([path.join(folder, 'index.ts')]);
  });

  it('skips a disabled folder without ever importing it', async () => {
    writePluginFolder('blocked');
    const { loader, loaded } = makeRecordingLoader('blocked');

    const plugins = await runWithFileSystem((fileSystem) =>
      discoverPlugins(fileSystem, loader, new Set(['blocked'])),
    );

    expect(plugins).toEqual([]);
    expect(loaded).toEqual([]);
  });

  it('skips a disabled plugin identified by package.json#name even when the folder name differs', async () => {
    writePluginFolder('github-alice-plugin', {
      packageJsonName: 'alice-plugin',
    });
    const { loader, loaded } = makeRecordingLoader('alice-plugin');

    const plugins = await runWithFileSystem((fileSystem) =>
      discoverPlugins(fileSystem, loader, new Set(['alice-plugin'])),
    );

    expect(plugins).toEqual([]);
    expect(loaded).toEqual([]);
  });

  it('still imports a plugin once when its disabled manifest name matches neither its folder nor package.json#name', async () => {
    // Documents the known gap: `disabledPluginNames` is keyed by manifest
    // name, which this discovery pass can't learn without importing.
    writePluginFolder('github-alice-plugin', {
      packageJsonName: 'alice-plugin',
    });
    const { loader, loaded } = makeRecordingLoader('totally-different-name');

    const plugins = await runWithFileSystem((fileSystem) =>
      discoverPlugins(fileSystem, loader, new Set(['totally-different-name'])),
    );

    expect(plugins.map((plugin) => plugin.name)).toEqual([
      'totally-different-name',
    ]);
    expect(loaded).toHaveLength(1);
  });

  it('returns an empty list when the plugins directory does not exist', async () => {
    const plugins = await runWithFileSystem((fileSystem) =>
      discoverPlugins(fileSystem, makeLoaderStub({}), new Set()),
    );

    expect(plugins).toEqual([]);
  });
});
