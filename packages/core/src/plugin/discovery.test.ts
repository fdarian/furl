import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BunFileSystem } from '@effect/platform-bun';
import { Effect, FileSystem } from 'effect';

import { discoverPlugins, loadPluginManifest } from './discovery.ts';
import type { PluginLoaderShape } from './loader.ts';

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
    fs.mkdirSync(path.join(folder, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'dist/entry.js'), '');
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

  it('rejects a package.json#main that escapes the plugin folder via ".."', async () => {
    const folder = path.join(tempDir, 'escaping-main');
    fs.mkdirSync(folder, { recursive: true });
    const outsideDir = path.join(tempDir, 'elsewhere');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'index.ts'), '');
    fs.writeFileSync(
      path.join(folder, 'package.json'),
      JSON.stringify({ main: '../elsewhere/index.ts' }),
    );

    const error = await runWithFileSystem((fileSystem) =>
      Effect.flip(loadPluginManifest(fileSystem, makeLoaderStub({}), folder)),
    );

    expect(error._tag).toBe('PluginLoadError');
    expect(String(error.cause)).toContain('outside the plugin folder');
  });

  it('rejects a package.json#main that escapes the plugin folder via a symlink', async () => {
    const folder = path.join(tempDir, 'symlinked-main');
    fs.mkdirSync(folder, { recursive: true });
    const outsideDir = path.join(tempDir, 'symlink-target');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'index.ts'), '');
    fs.symlinkSync(
      path.join(outsideDir, 'index.ts'),
      path.join(folder, 'entry.ts'),
    );
    fs.writeFileSync(
      path.join(folder, 'package.json'),
      JSON.stringify({ main: 'entry.ts' }),
    );

    const error = await runWithFileSystem((fileSystem) =>
      Effect.flip(loadPluginManifest(fileSystem, makeLoaderStub({}), folder)),
    );

    expect(error._tag).toBe('PluginLoadError');
    expect(String(error.cause)).toContain('outside the plugin folder');
  });
});

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

  const pluginsDirectory = () =>
    path.join(tempHome, '.config', 'furl', 'plugins');

  const writePluginFolder = (folderName: string): string => {
    const folder = path.join(pluginsDirectory(), folderName);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'index.ts'), '');
    return folder;
  };

  it('imports and returns a valid plugin folder', async () => {
    const folder = writePluginFolder('a');
    const loaded: string[] = [];
    const loader: PluginLoaderShape = {
      load: (entrypointPath) => {
        loaded.push(entrypointPath);
        return Effect.succeed(validManifest('a'));
      },
    };

    const plugins = await runWithFileSystem((fileSystem) =>
      discoverPlugins(fileSystem, loader),
    );

    expect(plugins.map((plugin) => plugin.name)).toEqual(['a']);
    expect(loaded).toEqual([path.join(folder, 'index.ts')]);
  });

  it('returns an empty list when the plugins directory does not exist', async () => {
    const plugins = await runWithFileSystem((fileSystem) =>
      discoverPlugins(fileSystem, makeLoaderStub({})),
    );

    expect(plugins).toEqual([]);
  });
});
