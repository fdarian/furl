import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BunFileSystem } from '@effect/platform-bun';
import { Effect, FileSystem, Option } from 'effect';
import { PluginInstallError } from '../errors.ts';
import type { PluginInstallResult } from './install.ts';
import { derivePluginFolderName, validateInstalledPlugin } from './install.ts';
import type { PluginLoader } from './loader.ts';

const runFail = <A, E>(effect: Effect.Effect<A, E>): Promise<E> =>
  Effect.runPromise(Effect.flip(effect));

const makeLoaderStub = (
  manifestByEntrypoint: Readonly<Record<string, unknown>>,
): PluginLoader['Service'] => ({
  load: (entrypointPath) =>
    Effect.succeed(manifestByEntrypoint[entrypointPath]),
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

const validManifest = (name: string) => ({
  name: name,
  match: { hostname: `${name}.example.com` },
  resolve: () => null,
});

const makeInstalled = (folderPath: string): PluginInstallResult => ({
  url: 'https://github.com/example/plugin',
  folderPath: folderPath,
  packageName: Option.none<string>(),
});

describe('derivePluginFolderName', () => {
  it('accepts an https URL', async () => {
    const folderName = await Effect.runPromise(
      derivePluginFolderName('https://github.com/foo/bar'),
    );

    expect(folderName).toBe('github-foo-bar');
  });

  it('accepts ssh and git URLs', async () => {
    const sshFolderName = await Effect.runPromise(
      derivePluginFolderName('ssh://git@github.com/foo/bar.git'),
    );
    const gitFolderName = await Effect.runPromise(
      derivePluginFolderName('git://github.com/foo/bar.git'),
    );

    expect(sshFolderName).toBe('github-foo-bar');
    expect(gitFolderName).toBe('github-foo-bar');
  });

  it('rejects transports that could execute a local command', async () => {
    const error = await runFail(
      derivePluginFolderName('ext::sh -c "touch /tmp/pwned"'),
    );

    expect(error._tag).toBe('PluginInstallError');
    expect(String(error.cause)).toContain('Unsupported URL scheme');
  });

  it('rejects file, ftp, and javascript URLs', async () => {
    const fileError = await runFail(
      derivePluginFolderName('file:///etc/passwd'),
    );
    const ftpError = await runFail(
      derivePluginFolderName('ftp://example.com/foo/bar'),
    );
    const javascriptError = await runFail(
      derivePluginFolderName('javascript:alert(1)'),
    );

    expect(fileError._tag).toBe('PluginInstallError');
    expect(ftpError._tag).toBe('PluginInstallError');
    expect(javascriptError._tag).toBe('PluginInstallError');
  });

  it('uses a single-label hostname and strips trailing git suffixes', async () => {
    const localFolderName = await Effect.runPromise(
      derivePluginFolderName('https://localhost/foo/bar'),
    );
    const nestedFolderName = await Effect.runPromise(
      derivePluginFolderName('https://gitlab.com/group/sub/project.git'),
    );

    expect(localFolderName).toBe('localhost-foo-bar');
    expect(nestedFolderName).toBe('gitlab-group-sub-project');
  });

  it('rejects URLs without a repository path and malformed URLs', async () => {
    const emptyPathError = await runFail(
      derivePluginFolderName('https://github.com'),
    );
    const malformedError = await runFail(derivePluginFolderName('not a url'));

    expect(String(emptyPathError.cause)).toContain('no repository path');
    expect(malformedError._tag).toBe('PluginInstallError');
  });
});

describe('PluginInstallError', () => {
  it('redacts URL userinfo from its display message', () => {
    const error = new PluginInstallError({
      url: 'https://token:secret@example.com/plugin',
      cause: new Error(
        "fatal: repository 'https://token:secret@example.com/plugin' not found",
      ),
    });

    expect(error.message).toBe(
      "Failed to install plugin from https://[redacted]@example.com/plugin: fatal: repository 'https://[redacted]@example.com/plugin' not found",
    );
    expect(error.message).not.toContain('secret');
  });
});

describe('validateInstalledPlugin', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'furl-plugin-install-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('validates a cloned manifest without importing it through the test loader', async () => {
    const folder = path.join(tempDir, 'alpha');
    const entrypoint = path.join(folder, 'index.ts');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(entrypoint, '');

    const plugin = await runWithFileSystem((fileSystem) =>
      validateInstalledPlugin(
        fileSystem,
        makeLoaderStub({ [entrypoint]: validManifest('alpha') }),
        makeInstalled(folder),
        [],
      ),
    );

    expect(plugin.name).toBe('alpha');
    expect(plugin.entrypoint).toBe(entrypoint);
  });

  it('does not treat the cloned folder as an existing duplicate', async () => {
    const folder = path.join(tempDir, 'alpha');
    const entrypoint = path.join(folder, 'index.ts');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(entrypoint, '');

    const plugin = await runWithFileSystem((fileSystem) =>
      validateInstalledPlugin(
        fileSystem,
        makeLoaderStub({ [entrypoint]: validManifest('alpha') }),
        makeInstalled(folder),
        [
          {
            name: 'alpha',
            folder: folder,
            entrypoint: entrypoint,
            manifest: validManifest('alpha'),
          },
        ],
      ),
    );

    expect(plugin.name).toBe('alpha');
  });

  it('rejects an invalid manifest and duplicate manifest names', async () => {
    const invalidFolder = path.join(tempDir, 'invalid');
    const invalidEntrypoint = path.join(invalidFolder, 'index.ts');
    fs.mkdirSync(invalidFolder, { recursive: true });
    fs.writeFileSync(invalidEntrypoint, '');

    const invalidError = await runWithFileSystem((fileSystem) =>
      Effect.flip(
        validateInstalledPlugin(
          fileSystem,
          makeLoaderStub({
            [invalidEntrypoint]: {
              name: 'invalid',
              match: { hostname: 'invalid.example.com' },
            },
          }),
          makeInstalled(invalidFolder),
          [],
        ),
      ),
    );

    const duplicateFolder = path.join(tempDir, 'duplicate');
    const duplicateEntrypoint = path.join(duplicateFolder, 'index.ts');
    fs.mkdirSync(duplicateFolder, { recursive: true });
    fs.writeFileSync(duplicateEntrypoint, '');

    const duplicateError = await runWithFileSystem((fileSystem) =>
      Effect.flip(
        validateInstalledPlugin(
          fileSystem,
          makeLoaderStub({ [duplicateEntrypoint]: validManifest('alpha') }),
          makeInstalled(duplicateFolder),
          [
            {
              name: 'alpha',
              folder: path.join(tempDir, 'existing'),
              entrypoint: path.join(tempDir, 'existing/index.ts'),
              manifest: validManifest('alpha'),
            },
          ],
        ),
      ),
    );

    expect(String((invalidError.cause as { cause: unknown }).cause)).toContain(
      'resolve',
    );
    expect(duplicateError.message).toContain('already installed');
  });

  it('rejects a package main that escapes the cloned plugin folder', async () => {
    const folder = path.join(tempDir, 'escaping');
    const outside = path.join(tempDir, 'outside.ts');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(outside, '');
    fs.writeFileSync(
      path.join(folder, 'package.json'),
      JSON.stringify({ main: '../outside.ts' }),
    );

    const error = await runWithFileSystem((fileSystem) =>
      Effect.flip(
        validateInstalledPlugin(
          fileSystem,
          makeLoaderStub({}),
          makeInstalled(folder),
          [],
        ),
      ),
    );

    expect(error._tag).toBe('PluginInstallError');
    expect(String((error.cause as { cause: unknown }).cause)).toContain(
      'outside the plugin folder',
    );
  });
});
