import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BunFileSystem } from '@effect/platform-bun';
import { Effect, FileSystem } from 'effect';

import { PluginLoadError } from '../errors.ts';
import {
  discoverPlugins,
  listInstalledPluginNames,
  loadPluginManifest,
} from './discovery.ts';
import type { PluginLoader } from './loader.ts';

const makeLoaderStub = (
  manifestByEntrypoint: Readonly<Record<string, unknown>>,
): PluginLoader['Service'] => ({
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

  const loadWithManifest = (folderName: string, manifest: unknown) => {
    const folder = path.join(tempDir, folderName);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'index.ts'), '');
    const loader = makeLoaderStub({
      [path.join(folder, 'index.ts')]: manifest,
    });

    return runWithFileSystem((fileSystem) =>
      Effect.result(loadPluginManifest(fileSystem, loader, folder)),
    );
  };

  it.each(['Upper', '-leading', '_leading', 'has space', 'a/b', 'a:b', '../x'])(
    'rejects the plugin name %p',
    async (name) => {
      const result = await loadWithManifest('bad-name', {
        ...validManifest('placeholder'),
        name: name,
      });

      expect(result._tag).toBe('Failure');
    },
  );

  it.each(['a', 'x1', 'my-plugin', 'my_plugin', '0abc'])(
    'accepts the plugin name %p',
    async (name) => {
      const result = await loadWithManifest('good-name', validManifest(name));

      expect(result._tag).toBe('Success');
    },
  );

  it.each([
    ['a non-array config', { key: 'k', type: 'string' }],
    ['a non-object field', ['k']],
    ['a field without a key', [{ type: 'string' }]],
    ['a key with a dot', [{ key: 'a.b', type: 'string' }]],
    ['an empty key', [{ key: '', type: 'string' }]],
    ['an unknown type', [{ key: 'k', type: 'password' }]],
    ['a missing type', [{ key: 'k' }]],
    ['an enum without options', [{ key: 'k', type: 'enum' }]],
    ['an enum with empty options', [{ key: 'k', type: 'enum', options: [] }]],
    [
      'an enum with non-string options',
      [{ key: 'k', type: 'enum', options: [1] }],
    ],
    [
      'an enum with an empty-string option',
      [{ key: 'k', type: 'enum', options: [''] }],
    ],
  ])('rejects %s in config', async (_label, config) => {
    const result = await loadWithManifest('bad-config', {
      ...validManifest('bad-config'),
      config: config,
    });

    expect(result._tag).toBe('Failure');
  });

  it('accepts a well-formed config', async () => {
    const result = await loadWithManifest('good-config', {
      ...validManifest('good-config'),
      config: [
        { key: 'apiKey', type: 'secret', required: true },
        { key: 'mode', type: 'enum', options: ['a', 'b'] },
        { key: 'retry-count', type: 'number' },
        { key: 'flag_1', type: 'boolean' },
        { key: 'label', type: 'string' },
      ],
    });

    expect(result._tag).toBe('Success');
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

  it('rejects a default index.ts that escapes the plugin folder via a symlink', async () => {
    const folder = path.join(tempDir, 'symlinked-index');
    fs.mkdirSync(folder, { recursive: true });
    const outsideDir = path.join(tempDir, 'symlink-index-target');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'index.ts'), '');
    fs.symlinkSync(
      path.join(outsideDir, 'index.ts'),
      path.join(folder, 'index.ts'),
    );

    const error = await runWithFileSystem((fileSystem) =>
      Effect.flip(loadPluginManifest(fileSystem, makeLoaderStub({}), folder)),
    );

    expect(error._tag).toBe('PluginLoadError');
    expect(String(error.cause)).toContain('outside the plugin folder');
  });
});

describe('plugin discovery', () => {
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

  const makeRecordingLoader = (
    manifestByFolderName: Readonly<Record<string, unknown>>,
  ) => {
    const loaded: string[] = [];
    const loader: PluginLoader['Service'] = {
      load: (entrypointPath) => {
        loaded.push(entrypointPath);
        return Effect.succeed(
          manifestByFolderName[path.basename(path.dirname(entrypointPath))],
        );
      },
    };

    return { loader: loader, loaded: loaded };
  };

  const failingLoader: PluginLoader['Service'] = {
    load: (entrypointPath) =>
      Effect.die(new Error(`unexpected import of ${entrypointPath}`)),
  };

  describe('discoverPlugins', () => {
    it('imports and returns a referenced plugin folder', async () => {
      const folder = writePluginFolder('a');
      const recording = makeRecordingLoader({ a: validManifest('a') });

      const plugins = await runWithFileSystem((fileSystem) =>
        discoverPlugins(fileSystem, recording.loader, ['a']),
      );

      expect(plugins.map((plugin) => plugin.name)).toEqual(['a']);
      expect(recording.loaded).toEqual([path.join(folder, 'index.ts')]);
    });

    it('never imports folders that are not referenced', async () => {
      writePluginFolder('wanted');
      writePluginFolder('unwanted');
      writePluginFolder('broken');
      const recording = makeRecordingLoader({
        wanted: validManifest('wanted'),
        unwanted: validManifest('unwanted'),
      });

      await runWithFileSystem((fileSystem) =>
        discoverPlugins(fileSystem, recording.loader, ['wanted']),
      );

      expect(
        recording.loaded.map((entry) => path.basename(path.dirname(entry))),
      ).toEqual(['wanted']);
    });

    it('imports a plugin referenced twice only once', async () => {
      writePluginFolder('a');
      const recording = makeRecordingLoader({ a: validManifest('a') });

      const plugins = await runWithFileSystem((fileSystem) =>
        discoverPlugins(fileSystem, recording.loader, ['a', 'a']),
      );

      expect(plugins).toHaveLength(1);
      expect(recording.loaded).toHaveLength(1);
    });

    it('returns an empty list and imports nothing when no plugin is referenced', async () => {
      writePluginFolder('a');

      const plugins = await runWithFileSystem((fileSystem) =>
        discoverPlugins(fileSystem, failingLoader, []),
      );

      expect(plugins).toEqual([]);
    });

    it('surfaces a referenced plugin that is not installed as a PluginLoadError', async () => {
      const error = await runWithFileSystem((fileSystem) =>
        Effect.flip(discoverPlugins(fileSystem, failingLoader, ['missing'])),
      );

      expect(error._tag).toBe('PluginLoadError');
      expect(error.message).toContain('not installed');
      expect(error.path).toBe(path.join(pluginsDirectory(), 'missing'));
    });

    it('surfaces an import failure as a PluginLoadError', async () => {
      writePluginFolder('a');
      const loader: PluginLoader['Service'] = {
        load: (entrypointPath) =>
          Effect.fail(
            new PluginLoadError({
              path: entrypointPath,
              cause: new Error('boom'),
            }),
          ),
      };

      const error = await runWithFileSystem((fileSystem) =>
        Effect.flip(discoverPlugins(fileSystem, loader, ['a'])),
      );

      expect(error._tag).toBe('PluginLoadError');
      expect(error.message).toContain('boom');
    });

    it('surfaces an invalid manifest as a PluginLoadError', async () => {
      writePluginFolder('a');
      const recording = makeRecordingLoader({ a: { name: 'a' } });

      const error = await runWithFileSystem((fileSystem) =>
        Effect.flip(discoverPlugins(fileSystem, recording.loader, ['a'])),
      );

      expect(error._tag).toBe('PluginLoadError');
    });

    it('fails when the manifest name differs from the folder name', async () => {
      writePluginFolder('a');
      const recording = makeRecordingLoader({ a: validManifest('other') });

      const error = await runWithFileSystem((fileSystem) =>
        Effect.flip(discoverPlugins(fileSystem, recording.loader, ['a'])),
      );

      expect(error._tag).toBe('PluginLoadError');
      expect(error.message).toContain('must match the manifest name');
    });

    it('rejects a folder that declares a different name, so duplicate names cannot occur', async () => {
      writePluginFolder('a');
      writePluginFolder('b');
      const recording = makeRecordingLoader({
        a: validManifest('a'),
        b: validManifest('a'),
      });

      const error = await runWithFileSystem((fileSystem) =>
        Effect.flip(discoverPlugins(fileSystem, recording.loader, ['a', 'b'])),
      );

      expect(error._tag).toBe('PluginLoadError');
    });

    it.each(['../outside', 'a/b', '/etc', 'Upper', '', '*', 'default:jina'])(
      'rejects the plugin name %p before touching the filesystem',
      async (name) => {
        const touched: string[] = [];
        const error = await runWithFileSystem((fileSystem) => {
          const spyFileSystem = {
            ...fileSystem,
            exists: (target: string) => {
              touched.push(target);
              return fileSystem.exists(target);
            },
            stat: (target: string) => {
              touched.push(target);
              return fileSystem.stat(target);
            },
          } as FileSystem.FileSystem;

          return Effect.flip(
            discoverPlugins(spyFileSystem, failingLoader, [name]),
          );
        });

        expect(error._tag).toBe('PluginLoadError');
        expect(error.message).toContain('Invalid plugin name');
        expect(touched).toEqual([]);
      },
    );
  });

  describe('listInstalledPluginNames', () => {
    it('returns an empty list when the plugins directory does not exist', async () => {
      const names = await runWithFileSystem((fileSystem) =>
        listInstalledPluginNames(fileSystem),
      );

      expect(names).toEqual([]);
    });

    it('lists valid plugin directories without importing anything', async () => {
      writePluginFolder('beta');
      writePluginFolder('alpha');
      writePluginFolder('Not-Valid');
      fs.writeFileSync(path.join(pluginsDirectory(), 'stray-file'), '');

      const names = await runWithFileSystem((fileSystem) =>
        listInstalledPluginNames(fileSystem),
      );

      expect(names).toEqual(['alpha', 'beta']);
    });

    it('lists a plugin folder even when its contents are broken', async () => {
      fs.mkdirSync(path.join(pluginsDirectory(), 'broken'), {
        recursive: true,
      });

      const names = await runWithFileSystem((fileSystem) =>
        listInstalledPluginNames(fileSystem),
      );

      expect(names).toEqual(['broken']);
    });
  });
});
