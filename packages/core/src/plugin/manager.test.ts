import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BunFileSystem } from '@effect/platform-bun';
import { Effect, FileSystem, Option } from 'effect';

import type { FurlConfig, FurlConfigServiceShape } from '../config-service.ts';
import { ConfigError } from '../errors.ts';
import type { PluginLoader } from './loader.ts';
import type { RunGit } from './manager.ts';
import {
  gitCloneArgs,
  gitSetRemoteUrlArgs,
  makePluginManager,
  parseGitUrl,
  registerInstalledPlugin,
  withoutCredentials,
} from './manager.ts';
import { makeSecretsStub } from './test-doubles.ts';

const runFail = <A, E>(effect: Effect.Effect<A, E>): Promise<E> =>
  Effect.runPromise(Effect.flip(effect));

const validManifest = (name: string) => ({
  name: name,
  match: { hostname: `${name}.example.com` },
  resolve: () => null,
});

describe('parseGitUrl', () => {
  it('accepts https and ssh URLs', async () => {
    const https = await Effect.runPromise(
      parseGitUrl('https://github.com/foo/bar'),
    );
    const ssh = await Effect.runPromise(
      parseGitUrl('ssh://git@github.com/foo/bar.git'),
    );

    expect(https.hostname).toBe('github.com');
    expect(ssh.hostname).toBe('github.com');
  });

  it('rejects the plaintext git: scheme', async () => {
    const error = await runFail(parseGitUrl('git://github.com/foo/bar.git'));

    expect(error._tag).toBe('PluginInstallError');
    expect(String(error.cause)).toContain('Unsupported URL scheme');
  });

  it('rejects transports that could execute a local command', async () => {
    const error = await runFail(parseGitUrl('ext::sh -c "touch /tmp/pwned"'));

    expect(error._tag).toBe('PluginInstallError');
  });

  it('rejects file, ftp, and javascript URLs and malformed input', async () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/foo/bar',
      'javascript:alert(1)',
      'not a url',
    ]) {
      const error = await runFail(parseGitUrl(url));
      expect(error._tag).toBe('PluginInstallError');
    }
  });

  it('rejects hostnames that git or ssh would read as options', async () => {
    const sshError = await runFail(
      parseGitUrl('ssh://-oProxyCommand=touch/foo/bar'),
    );
    const httpsError = await runFail(parseGitUrl('https://-evil.com/foo/bar'));

    expect(String(sshError.cause)).toContain('Invalid host');
    expect(String(httpsError.cause)).toContain('Invalid host');
  });

  it('keeps credentials out of both the stored url and cause', async () => {
    const error = await runFail(parseGitUrl('git://token:secret@host/foo/bar'));

    expect(error.url).not.toContain('secret');
    expect(String(error.cause)).not.toContain('secret');
    expect(error.message).not.toContain('secret');
  });
});

describe('git arguments', () => {
  it('separates the URL from options with --', () => {
    expect(gitCloneArgs('https://github.com/foo/bar', '/tmp/dest')).toEqual([
      'clone',
      '--depth',
      '1',
      '--',
      'https://github.com/foo/bar',
      '/tmp/dest',
    ]);
  });

  it('points the origin remote at the given URL', () => {
    expect(
      gitSetRemoteUrlArgs('/tmp/dest', 'https://github.com/foo/bar'),
    ).toEqual([
      '-C',
      '/tmp/dest',
      'remote',
      'set-url',
      'origin',
      'https://github.com/foo/bar',
    ]);
  });

  it('strips the userinfo of an https URL and only the password of an ssh URL', () => {
    expect(
      withoutCredentials(new URL('https://token:pw@github.com/foo/bar')).href,
    ).toBe('https://github.com/foo/bar');
    expect(
      withoutCredentials(new URL('https://token@github.com/foo/bar')).href,
    ).toBe('https://github.com/foo/bar');
    expect(
      withoutCredentials(new URL('ssh://git:pw@github.com/foo/bar')).href,
    ).toBe('ssh://git@github.com/foo/bar');
  });
});

describe('registerInstalledPlugin', () => {
  it('registers a new plugin at the front of the effective order', () => {
    const result = registerInstalledPlugin(
      { plugins: { existing: { token: 'keep' } } },
      ['default:*', 'default:jina'],
      'new-plugin',
    );

    expect(result).toEqual({
      order: ['plugin:new-plugin', 'default:*', 'default:jina'],
      plugins: { existing: { token: 'keep' }, 'new-plugin': {} },
    });
  });

  it('moves an existing plugin token to the front without duplicating it', () => {
    const config = {
      order: ['default:*', 'plugin:kept-plugin', 'plugin:kept-plugin'],
      plugins: { 'kept-plugin': { token: 'keep' } },
    };

    expect(
      registerInstalledPlugin(config, config.order, 'kept-plugin'),
    ).toEqual({
      order: ['plugin:kept-plugin', 'default:*'],
      plugins: { 'kept-plugin': { token: 'keep' } },
    });
  });
});

describe('plugin manager', () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'furl-manager-test-'));
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

  const configDirectory = () => path.join(tempHome, '.config', 'furl');
  const pluginsDirectory = () => path.join(configDirectory(), 'plugins');
  const stagingDirectories = () =>
    fs.existsSync(configDirectory())
      ? fs
          .readdirSync(configDirectory())
          .filter((entry) => entry.startsWith('.plugin-staging-'))
      : [];

  const makeConfigStub = (
    initial: FurlConfig,
    options: { failWrite?: boolean; failRead?: boolean } = {},
  ) => {
    const state = { config: initial, writes: 0 };
    const stub: FurlConfigServiceShape = {
      read:
        options.failRead === true
          ? Effect.fail(new ConfigError({ cause: new Error('unreadable') }))
          : Effect.sync(() => state.config),
      resolveProvider: Effect.die('unused'),
      resolveOrder: Effect.sync(() => state.config.order ?? ['default:*']),
      write: (config) =>
        options.failWrite === true
          ? Effect.fail(new ConfigError({ cause: new Error('disk full') }))
          : Effect.sync(() => {
              state.config = config;
              state.writes += 1;
            }),
    };

    return { state: state, stub: stub };
  };

  const makeGitFake = (
    repository: Readonly<Record<string, string>> = { 'index.ts': '' },
    options: { failClone?: boolean } = {},
  ) => {
    const calls: string[][] = [];
    const runGit: RunGit = (args) =>
      Effect.try({
        try: () => {
          calls.push([...args]);

          if (args[0] !== 'clone') {
            return;
          }

          if (options.failClone === true) {
            throw new Error(
              "fatal: could not read from 'https://token:secret@example.com/foo/bar'",
            );
          }

          const destination = args.at(-1);
          if (destination === undefined) {
            throw new Error('missing destination');
          }

          for (const entry of Object.entries(repository)) {
            const filePath = path.join(destination, entry[0]);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, entry[1]);
          }
        },
        catch: (cause) => cause,
      });

    return { calls: calls, runGit: runGit };
  };

  const makeLoader = (manifest: unknown) => {
    const loaded: string[] = [];
    const loader: PluginLoader['Service'] = {
      load: (entrypointPath) => {
        loaded.push(entrypointPath);
        return Effect.succeed(manifest);
      },
    };

    return { loader: loader, loaded: loaded };
  };

  const runWithManager = <A, E>(
    deps: {
      config: FurlConfigServiceShape;
      runGit: RunGit;
      loader: PluginLoader['Service'];
      secrets?: ReturnType<typeof makeSecretsStub>;
    },
    build: (
      manager: ReturnType<typeof makePluginManager>,
    ) => Effect.Effect<A, E>,
  ): Promise<A> =>
    Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          return yield* build(
            makePluginManager({
              fileSystem: fileSystem,
              loader: deps.loader,
              config: deps.config,
              secrets: deps.secrets ?? makeSecretsStub(),
              runGit: deps.runGit,
            }),
          );
        }),
        BunFileSystem.layer,
      ),
    );

  describe('install', () => {
    const confirmYes = () => Effect.succeed(true);
    const url = 'https://github.com/foo/bar';

    it('clones into staging, confirms, validates, moves into plugins/<name> and registers', async () => {
      const git = makeGitFake({
        'index.ts': '',
        'package.json': JSON.stringify({
          name: 'furl-alpha',
          description: 'does alpha things',
        }),
      });
      const config = makeConfigStub({ plugins: { other: { keep: true } } });
      const loader = makeLoader(validManifest('alpha'));
      let preview: unknown;

      const outcome = await runWithManager(
        { config: config.stub, runGit: git.runGit, loader: loader.loader },
        (manager) =>
          manager.install(url, (received) => {
            preview = received;
            return Effect.succeed(true);
          }),
      );

      const folder = path.join(pluginsDirectory(), 'alpha');
      expect(outcome).toEqual({
        status: 'installed',
        name: 'alpha',
        folder: folder,
      });
      expect(fs.existsSync(path.join(folder, 'index.ts'))).toBe(true);
      expect(stagingDirectories()).toEqual([]);
      expect(config.state.config).toEqual({
        order: ['plugin:alpha', 'default:*'],
        plugins: { other: { keep: true }, alpha: {} },
      });
      expect(preview).toEqual({
        url: url,
        packageName: Option.some('furl-alpha'),
        packageDescription: Option.some('does alpha things'),
      });

      const cloneArgs = git.calls[0];
      expect(cloneArgs?.slice(0, 5)).toEqual([
        'clone',
        '--depth',
        '1',
        '--',
        url,
      ]);
      const stagingPath = cloneArgs?.[5] ?? '';
      expect(path.dirname(stagingPath)).toBe(configDirectory());
      expect(loader.loaded[0]?.startsWith(stagingPath)).toBe(true);
    });

    it('does not import any plugin code before the confirmation is answered', async () => {
      const loader = makeLoader(validManifest('alpha'));
      let loadedAtConfirmation = -1;

      await runWithManager(
        {
          config: makeConfigStub({}).stub,
          runGit: makeGitFake().runGit,
          loader: loader.loader,
        },
        (manager) =>
          manager.install(url, () => {
            loadedAtConfirmation = loader.loaded.length;
            return Effect.succeed(true);
          }),
      );

      expect(loadedAtConfirmation).toBe(0);
      expect(loader.loaded).toHaveLength(1);
    });

    it('cleans up staging and registers nothing when the confirmation is declined', async () => {
      const config = makeConfigStub({});
      const loader = makeLoader(validManifest('alpha'));

      const outcome = await runWithManager(
        {
          config: config.stub,
          runGit: makeGitFake().runGit,
          loader: loader.loader,
        },
        (manager) => manager.install(url, () => Effect.succeed(false)),
      );

      expect(outcome).toEqual({ status: 'cancelled' });
      expect(loader.loaded).toEqual([]);
      expect(config.state.writes).toBe(0);
      expect(stagingDirectories()).toEqual([]);
      expect(fs.existsSync(pluginsDirectory())).toBe(false);
    });

    it('reads the config before cloning', async () => {
      const git = makeGitFake();

      const error = await runWithManager(
        {
          config: makeConfigStub({}, { failRead: true }).stub,
          runGit: git.runGit,
          loader: makeLoader(validManifest('alpha')).loader,
        },
        (manager) => Effect.flip(manager.install(url, confirmYes)),
      );

      expect(error._tag).toBe('ConfigError');
      expect(git.calls).toEqual([]);
      expect(stagingDirectories()).toEqual([]);
    });

    it('rejects an invalid URL without cloning', async () => {
      const git = makeGitFake();

      const error = await runWithManager(
        {
          config: makeConfigStub({}).stub,
          runGit: git.runGit,
          loader: makeLoader(validManifest('alpha')).loader,
        },
        (manager) =>
          Effect.flip(manager.install('git://host/foo/bar', confirmYes)),
      );

      expect(error._tag).toBe('PluginInstallError');
      expect(git.calls).toEqual([]);
    });

    it('removes staging and redacts credentials when the clone fails', async () => {
      const error = await runWithManager(
        {
          config: makeConfigStub({}).stub,
          runGit: makeGitFake({}, { failClone: true }).runGit,
          loader: makeLoader(validManifest('alpha')).loader,
        },
        (manager) =>
          Effect.flip(
            manager.install(
              'https://token:secret@example.com/foo/bar',
              confirmYes,
            ),
          ),
      );

      expect(error._tag).toBe('PluginInstallError');
      expect(error.message).not.toContain('secret');
      expect(String(error.cause)).not.toContain('secret');
      expect(JSON.stringify(error)).not.toContain('secret');
      expect(stagingDirectories()).toEqual([]);
    });

    it('strips credentials from the cloned remote', async () => {
      const git = makeGitFake();

      await runWithManager(
        {
          config: makeConfigStub({}).stub,
          runGit: git.runGit,
          loader: makeLoader(validManifest('alpha')).loader,
        },
        (manager) =>
          manager.install(
            'https://token:secret@example.com/foo/bar',
            confirmYes,
          ),
      );

      expect(git.calls[0]?.[4]).toBe(
        'https://token:secret@example.com/foo/bar',
      );
      expect(git.calls[1]?.slice(2)).toEqual([
        'remote',
        'set-url',
        'origin',
        'https://example.com/foo/bar',
      ]);
    });

    it('does not rewrite the remote when the URL has no credentials', async () => {
      const git = makeGitFake();

      await runWithManager(
        {
          config: makeConfigStub({}).stub,
          runGit: git.runGit,
          loader: makeLoader(validManifest('alpha')).loader,
        },
        (manager) => manager.install(url, confirmYes),
      );

      expect(git.calls).toHaveLength(1);
    });

    it('refuses to overwrite an installed plugin of the same name and cleans staging', async () => {
      const existing = path.join(pluginsDirectory(), 'alpha');
      fs.mkdirSync(existing, { recursive: true });
      fs.writeFileSync(path.join(existing, 'marker'), 'original');
      const config = makeConfigStub({});

      const error = await runWithManager(
        {
          config: config.stub,
          runGit: makeGitFake().runGit,
          loader: makeLoader(validManifest('alpha')).loader,
        },
        (manager) => Effect.flip(manager.install(url, confirmYes)),
      );

      expect(error._tag).toBe('PluginInstallError');
      expect(error.message).toContain('already installed');
      expect(fs.readFileSync(path.join(existing, 'marker'), 'utf8')).toBe(
        'original',
      );
      expect(config.state.writes).toBe(0);
      expect(stagingDirectories()).toEqual([]);
    });

    it('names the folder after the manifest, not the URL', async () => {
      const outcome = await runWithManager(
        {
          config: makeConfigStub({}).stub,
          runGit: makeGitFake().runGit,
          loader: makeLoader(validManifest('my-name')).loader,
        },
        (manager) =>
          manager.install('https://github.com/someone/unrelated', confirmYes),
      );

      expect(outcome.status === 'installed' && outcome.name).toBe('my-name');
      expect(fs.existsSync(path.join(pluginsDirectory(), 'my-name'))).toBe(
        true,
      );
    });

    it('rejects an invalid manifest and leaves nothing behind', async () => {
      const config = makeConfigStub({});

      const error = await runWithManager(
        {
          config: config.stub,
          runGit: makeGitFake().runGit,
          loader: makeLoader({ name: 'alpha' }).loader,
        },
        (manager) => Effect.flip(manager.install(url, confirmYes)),
      );

      expect(error._tag).toBe('PluginInstallError');
      expect(stagingDirectories()).toEqual([]);
      expect(fs.existsSync(path.join(pluginsDirectory(), 'alpha'))).toBe(false);
      expect(config.state.writes).toBe(0);
    });

    it('rejects a manifest name that would escape plugins/', async () => {
      const error = await runWithManager(
        {
          config: makeConfigStub({}).stub,
          runGit: makeGitFake().runGit,
          loader: makeLoader(validManifest('../evil')).loader,
        },
        (manager) => Effect.flip(manager.install(url, confirmYes)),
      );

      expect(error._tag).toBe('PluginInstallError');
      expect(fs.existsSync(path.join(configDirectory(), 'evil'))).toBe(false);
    });

    it('rolls the plugin folder back when the config write fails', async () => {
      const error = await runWithManager(
        {
          config: makeConfigStub({}, { failWrite: true }).stub,
          runGit: makeGitFake().runGit,
          loader: makeLoader(validManifest('alpha')).loader,
        },
        (manager) => Effect.flip(manager.install(url, confirmYes)),
      );

      expect(error._tag).toBe('ConfigError');
      expect(fs.existsSync(path.join(pluginsDirectory(), 'alpha'))).toBe(false);
      expect(stagingDirectories()).toEqual([]);
    });
  });

  describe('uninstall', () => {
    const writePlugin = (name: string, files: Record<string, string> = {}) => {
      const folder = path.join(pluginsDirectory(), name);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'index.ts'), 'throw new Error("x")');
      for (const entry of Object.entries(files)) {
        fs.writeFileSync(path.join(folder, entry[0]), entry[1]);
      }
      return folder;
    };

    const failingLoader: PluginLoader['Service'] = {
      load: (entrypointPath) =>
        Effect.die(new Error(`unexpected import of ${entrypointPath}`)),
    };

    const uninstallWith = (
      config: ReturnType<typeof makeConfigStub>,
      name: string,
      secrets = makeSecretsStub(),
    ) =>
      runWithManager(
        {
          config: config.stub,
          runGit: makeGitFake().runGit,
          loader: failingLoader,
          secrets: secrets,
        },
        (manager) => Effect.result(manager.uninstall(name)),
      );

    it('removes the token, the plugin config, its secrets and the folder without importing', async () => {
      const folder = writePlugin('alpha');
      const secrets = makeSecretsStub({
        'secret/alpha.apiKey': 'a',
        'secret/alpha.nested': 'b',
        'secret/other.key': 'c',
      });
      const config = makeConfigStub({
        order: ['plugin:alpha', 'plugin:beta', 'default:*'],
        plugins: {
          alpha: {
            apiKey: 'secret:alpha.apiKey',
            deep: { list: [{ token: 'secret:alpha.nested' }] },
          },
          beta: { key: 'secret:other.key' },
        },
      });

      const result = await uninstallWith(config, 'alpha', secrets);

      expect(result._tag).toBe('Success');
      expect(config.state.config).toEqual({
        order: ['plugin:beta', 'default:*'],
        plugins: { beta: { key: 'secret:other.key' } },
      });
      expect(fs.existsSync(folder)).toBe(false);
      expect(
        await Effect.runPromise(secrets.get('secret/alpha.apiKey')),
      ).toBeNull();
      expect(
        await Effect.runPromise(secrets.get('secret/alpha.nested')),
      ).toBeNull();
      expect(await Effect.runPromise(secrets.get('secret/other.key'))).toBe(
        'c',
      );
    });

    it('drops the order key when the last token was the plugin', async () => {
      writePlugin('alpha');
      const config = makeConfigStub({
        order: ['plugin:alpha'],
        plugins: { alpha: {} },
      });

      await uninstallWith(config, 'alpha');

      expect(config.state.config.order).toBeUndefined();
    });

    it('cleans the config of a plugin whose folder is already gone', async () => {
      const config = makeConfigStub({
        order: ['plugin:ghost', 'default:*'],
        plugins: { ghost: { a: 1 } },
      });

      const result = await uninstallWith(config, 'ghost');

      expect(result._tag === 'Success' && result.success.folderRemoved).toBe(
        false,
      );
      expect(config.state.config).toEqual({
        order: ['default:*'],
        plugins: {},
      });
    });

    it('removes a broken plugin folder without importing it', async () => {
      const folder = writePlugin('broken', { 'package.json': '{ not json' });

      const result = await uninstallWith(makeConfigStub({}), 'broken');

      expect(result._tag).toBe('Success');
      expect(fs.existsSync(folder)).toBe(false);
    });

    it('fails with a tagged PluginNotFoundError when neither folder nor config exist', async () => {
      const config = makeConfigStub({ order: ['default:*'], plugins: {} });

      const result = await uninstallWith(config, 'nothing');

      expect(result._tag === 'Failure' && result.failure._tag).toBe(
        'PluginNotFoundError',
      );
      expect(config.state.writes).toBe(0);
    });

    it.each(['../outside', 'a/b', '/etc/passwd', '..', 'Upper', '*', ''])(
      'rejects the name %p before touching the filesystem or config',
      async (name) => {
        const outside = path.join(configDirectory(), 'outside');
        fs.mkdirSync(outside, { recursive: true });
        const config = makeConfigStub({ plugins: {} });

        const result = await uninstallWith(config, name);

        expect(result._tag === 'Failure' && result.failure._tag).toBe(
          'PluginUninstallError',
        );
        expect(fs.existsSync(outside)).toBe(true);
        expect(config.state.writes).toBe(0);
      },
    );

    it('writes the config before touching secrets or the folder', async () => {
      const folder = writePlugin('alpha');
      const config = makeConfigStub(
        {
          order: ['plugin:alpha'],
          plugins: { alpha: { k: 'secret:alpha.k' } },
        },
        { failWrite: true },
      );
      const secrets = makeSecretsStub({ 'secret/alpha.k': 'v' });

      const result = await uninstallWith(config, 'alpha', secrets);

      expect(result._tag).toBe('Failure');
      expect(fs.existsSync(folder)).toBe(true);
      expect(await Effect.runPromise(secrets.get('secret/alpha.k'))).toBe('v');
    });
  });
});
