import {
  Console,
  Context,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Schema,
} from 'effect';

import type { FurlConfig, FurlConfigServiceShape } from '../config-service.ts';
import {
  FurlConfigService,
  getConfigDirectoryPath,
  removePluginConfig,
} from '../config-service.ts';
import type { ConfigError, KeychainError } from '../errors.ts';
import {
  describeCause,
  PluginInstallError,
  PluginNotFoundError,
  PluginUninstallError,
  redactUrlUserInfo,
} from '../errors.ts';
import type { SecretsService } from '../secrets-service.ts';
import { Secrets } from '../secrets-service.ts';
import {
  getPluginFolderPath,
  getPluginsDirectoryPath,
  isValidPluginName,
  loadPluginManifest,
} from './discovery.ts';
import { PluginLoader } from './loader.ts';
import { insertPluginToken, pluginOrderToken } from './order.ts';
import {
  deleteGenericSecret,
  findPluginSecretNames,
} from './resolve-config.ts';

const allowedUrlSchemes = new Set(['https:', 'ssh:']);

// Keep Git's protocol allowlist aligned with the URL check, including if Git
// follows a redirect or another transport hint during the clone.
const gitAllowProtocol = 'https:ssh';

const stagingPrefix = '.plugin-staging-';

/** Runs `git <args>`; injected so the install flow can be tested without a network. */
export type RunGit = (args: readonly string[]) => Effect.Effect<void, unknown>;

export const runGitWithBun: RunGit = (args) =>
  Effect.tryPromise({
    try: async () => {
      const git = Bun.spawn(['git', ...args], {
        stdout: 'ignore',
        stderr: 'pipe',
        env: { ...process.env, GIT_ALLOW_PROTOCOL: gitAllowProtocol },
      });
      const exitCode = await git.exited;

      if (exitCode !== 0) {
        const stderr = (await Bun.readableStreamToText(git.stderr)).trim();
        throw new Error(
          `git exited with code ${exitCode}${stderr.length > 0 ? `: ${stderr}` : ''}`,
        );
      }
    },
    catch: (cause) => cause,
  });

export const gitCloneArgs = (href: string, destination: string): string[] => [
  'clone',
  '--depth',
  '1',
  '--',
  href,
  destination,
];

export const gitSetRemoteUrlArgs = (
  repository: string,
  url: string,
): string[] => ['-C', repository, 'remote', 'set-url', 'origin', url];

const redactCause = (cause: unknown): unknown => {
  const description = redactUrlUserInfo(describeCause(cause));
  return cause instanceof Error ? new Error(description) : description;
};

/** Builds the install error with credentials removed from both the URL and the stored cause. */
const installError = (url: string, cause: unknown): PluginInstallError =>
  new PluginInstallError({
    url: redactUrlUserInfo(url),
    cause: redactCause(cause),
  });

export const parseGitUrl = (
  url: string,
): Effect.Effect<URL, PluginInstallError> =>
  Effect.gen(function* () {
    const parsedUrl = yield* Effect.try({
      try: () => new URL(url),
      catch: (cause) => installError(url, cause),
    });

    if (!allowedUrlSchemes.has(parsedUrl.protocol)) {
      return yield* installError(
        url,
        new Error(
          `Unsupported URL scheme "${parsedUrl.protocol}" - only https: and ssh: are allowed`,
        ),
      );
    }

    // A host like "-oProxyCommand=..." would be parsed by ssh as an option.
    if (parsedUrl.hostname.startsWith('-')) {
      return yield* installError(
        url,
        new Error(`Invalid host "${parsedUrl.hostname}"`),
      );
    }

    return parsedUrl;
  });

/** The URL minus anything that grants access: the whole userinfo for https, only the password for ssh. */
export const withoutCredentials = (parsed: URL): URL => {
  const clean = new URL(parsed.href);
  clean.password = '';

  if (clean.protocol === 'https:') {
    clean.username = '';
  }

  return clean;
};

const packageJsonSchema = Schema.Struct({
  name: Schema.optional(Schema.Unknown),
  description: Schema.optional(Schema.Unknown),
});
const decodePackageJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(packageJsonSchema),
);

export type InstallPreview = {
  /** Credentials already redacted. */
  url: string;
  packageName: Option.Option<string>;
  packageDescription: Option.Option<string>;
};

/** Reads `package.json` as plain JSON; nothing from the clone is imported. */
const readInstallPreview = (
  fileSystem: FileSystem.FileSystem,
  url: string,
  folderPath: string,
): Effect.Effect<InstallPreview, PluginInstallError> =>
  Effect.gen(function* () {
    const packageJsonPath = `${folderPath}/package.json`;
    const packageJsonExists = yield* fileSystem
      .exists(packageJsonPath)
      .pipe(Effect.mapError((cause) => installError(url, cause)));
    const preview: InstallPreview = {
      url: redactUrlUserInfo(url),
      packageName: Option.none(),
      packageDescription: Option.none(),
    };

    if (!packageJsonExists) {
      return preview;
    }

    const rawPackageJson = yield* fileSystem
      .readFileString(packageJsonPath)
      .pipe(Effect.mapError((cause) => installError(url, cause)));
    const packageJson = yield* decodePackageJson(rawPackageJson).pipe(
      Effect.mapError((cause) => installError(url, cause)),
    );

    return {
      ...preview,
      packageName:
        typeof packageJson.name === 'string'
          ? Option.some(packageJson.name)
          : Option.none(),
      packageDescription:
        typeof packageJson.description === 'string'
          ? Option.some(packageJson.description)
          : Option.none(),
    };
  });

export const registerInstalledPlugin = (
  config: FurlConfig,
  order: readonly string[],
  pluginName: string,
): FurlConfig => {
  const hasPluginConfig =
    config.plugins !== undefined && Object.hasOwn(config.plugins, pluginName);
  const plugins =
    config.plugins === undefined
      ? { [pluginName]: {} }
      : hasPluginConfig
        ? config.plugins
        : { ...config.plugins, [pluginName]: {} };

  return {
    ...config,
    order: insertPluginToken(order, pluginName),
    plugins: plugins,
  };
};

/** Removes a folder, reporting (not swallowing) a failure so leftovers are visible. */
const removeFolderReportingFailure = (
  fileSystem: FileSystem.FileSystem,
  folderPath: string,
): Effect.Effect<void> =>
  fileSystem
    .remove(folderPath, { recursive: true, force: true })
    .pipe(
      Effect.catch((error) =>
        Console.error(
          `↳ could not remove "${folderPath}": ${describeCause(error)}. Delete it manually.`,
        ),
      ),
    );

export type InstallOutcome =
  | { status: 'installed'; name: string; folder: string }
  | { status: 'cancelled' };

export type UninstallResult = {
  name: string;
  folder: string;
  folderRemoved: boolean;
};

export type PluginManagerDeps = {
  fileSystem: FileSystem.FileSystem;
  loader: PluginLoader['Service'];
  config: FurlConfigServiceShape;
  secrets: SecretsService;
  runGit: RunGit;
};

export const makePluginManager = (deps: PluginManagerDeps) => {
  const fileSystem = deps.fileSystem;

  const install = <E, R>(
    url: string,
    confirm: (preview: InstallPreview) => Effect.Effect<boolean, E, R>,
  ): Effect.Effect<InstallOutcome, PluginInstallError | ConfigError | E, R> =>
    Effect.scoped(
      Effect.gen(function* () {
        const parsed = yield* parseGitUrl(url);
        const configDirectory = yield* getConfigDirectoryPath;
        const pluginsDirectory = yield* getPluginsDirectoryPath;

        // Read before cloning so a broken config fails the install early.
        yield* deps.config.read;

        const staging = yield* Effect.acquireRelease(
          fileSystem.makeDirectory(configDirectory, { recursive: true }).pipe(
            Effect.andThen(
              fileSystem.makeTempDirectory({
                directory: configDirectory,
                prefix: stagingPrefix,
              }),
            ),
            Effect.mapError((cause) => installError(url, cause)),
          ),
          (directory) => removeFolderReportingFailure(fileSystem, directory),
        );

        yield* deps
          .runGit(gitCloneArgs(parsed.href, staging))
          .pipe(Effect.mapError((cause) => installError(url, cause)));

        const clean = withoutCredentials(parsed);
        if (clean.href !== parsed.href) {
          yield* deps
            .runGit(gitSetRemoteUrlArgs(staging, clean.href))
            .pipe(Effect.mapError((cause) => installError(url, cause)));
        }

        const preview = yield* readInstallPreview(fileSystem, url, staging);
        const confirmed = yield* confirm(preview);

        if (!confirmed) {
          return { status: 'cancelled' } as const;
        }

        const plugin = yield* loadPluginManifest(
          fileSystem,
          deps.loader,
          staging,
        ).pipe(Effect.mapError((cause) => installError(url, cause)));
        const folder = getPluginFolderPath(pluginsDirectory, plugin.name);

        const alreadyInstalled = yield* fileSystem
          .exists(folder)
          .pipe(Effect.mapError((cause) => installError(url, cause)));

        if (alreadyInstalled) {
          return yield* installError(
            url,
            new Error(
              `A plugin named "${plugin.name}" is already installed at "${folder}"; uninstall it first`,
            ),
          );
        }

        yield* fileSystem
          .makeDirectory(pluginsDirectory, { recursive: true })
          .pipe(
            Effect.andThen(fileSystem.rename(staging, folder)),
            Effect.mapError((cause) => installError(url, cause)),
          );

        yield* Effect.gen(function* () {
          const config = yield* deps.config.read;
          const order = yield* deps.config.resolveOrder;
          yield* deps.config.write(
            registerInstalledPlugin(config, order, plugin.name),
          );
        }).pipe(
          Effect.onExit((exit) =>
            Exit.isSuccess(exit)
              ? Effect.void
              : removeFolderReportingFailure(fileSystem, folder),
          ),
        );

        return {
          status: 'installed',
          name: plugin.name,
          folder: folder,
        } as const;
      }),
    );

  const uninstall = (
    name: string,
  ): Effect.Effect<
    UninstallResult,
    PluginNotFoundError | PluginUninstallError | ConfigError | KeychainError
  > =>
    Effect.gen(function* () {
      if (!isValidPluginName(name)) {
        return yield* new PluginUninstallError({
          name: name,
          cause: new Error('Invalid plugin name'),
        });
      }

      const pluginsDirectory = yield* getPluginsDirectoryPath;
      const folder = getPluginFolderPath(pluginsDirectory, name);
      const folderExists = yield* fileSystem
        .exists(folder)
        .pipe(
          Effect.mapError(
            (cause) => new PluginUninstallError({ name: name, cause: cause }),
          ),
        );
      const config = yield* deps.config.read;
      const isConfigured =
        (config.order?.includes(pluginOrderToken(name)) ?? false) ||
        (config.plugins !== undefined && Object.hasOwn(config.plugins, name));

      if (!folderExists && !isConfigured) {
        return yield* new PluginNotFoundError({ name: name });
      }

      // Config goes first so the plugin stops being referenced even if a later
      // step fails; the remaining steps work from what was read above.
      yield* deps.config.write(removePluginConfig(config, name));
      yield* Effect.forEach(
        new Set(findPluginSecretNames(name, config.plugins?.[name])),
        (secretName) => deleteGenericSecret(deps.secrets, secretName),
      );
      yield* fileSystem
        .remove(folder, { recursive: true, force: true })
        .pipe(
          Effect.mapError(
            (cause) => new PluginUninstallError({ name: name, cause: cause }),
          ),
        );

      return { name: name, folder: folder, folderRemoved: folderExists };
    });

  return { install: install, uninstall: uninstall };
};

export class PluginManager extends Context.Service<PluginManager>()(
  'furl/plugin-manager',
  {
    make: Effect.gen(function* () {
      return makePluginManager({
        fileSystem: yield* FileSystem.FileSystem,
        loader: yield* PluginLoader,
        config: yield* FurlConfigService,
        secrets: yield* Secrets,
        runGit: runGitWithBun,
      });
    }),
  },
) {
  static readonly layer = Layer.effect(PluginManager, PluginManager.make);
}
