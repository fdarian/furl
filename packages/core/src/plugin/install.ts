import { Effect, FileSystem, Option, Schema } from 'effect';

import { PluginInstallError } from '../errors.ts';

import type { DiscoveredPlugin } from './discovery.ts';
import { getPluginsDirectoryPath, loadPluginManifest } from './discovery.ts';
import type { PluginLoader } from './loader.ts';

const allowedUrlSchemes = new Set(['https:', 'ssh:', 'git:']);

// Keep Git's protocol allowlist aligned with the URL check, including if Git
// follows a redirect or another transport hint during the clone.
const gitAllowProtocol = 'https:ssh:git';

const packageJsonSchema = Schema.Struct({
  name: Schema.optional(Schema.Unknown),
});
const decodePackageJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(packageJsonSchema),
);

const parseAllowedGitUrl = (
  url: string,
): Effect.Effect<URL, PluginInstallError> =>
  Effect.gen(function* () {
    const parsedUrl = yield* Effect.try({
      try: () => new URL(url),
      catch: (cause) => new PluginInstallError({ url: url, cause: cause }),
    });

    if (!allowedUrlSchemes.has(parsedUrl.protocol)) {
      return yield* new PluginInstallError({
        url: url,
        cause: new Error(
          `Unsupported URL scheme "${parsedUrl.protocol}" - only https:, ssh:, and git: are allowed`,
        ),
      });
    }

    return parsedUrl;
  });

export const derivePluginFolderName = (
  url: string,
): Effect.Effect<string, PluginInstallError> =>
  Effect.gen(function* () {
    const parsedUrl = yield* parseAllowedGitUrl(url);
    const hostLabels = parsedUrl.hostname.split('.');
    const hostLabel = hostLabels.at(-2) ?? parsedUrl.hostname;
    const pathSegments = parsedUrl.pathname
      .split('/')
      .filter((segment) => segment.length > 0)
      .map((segment) => segment.replace(/\.git$/, ''));

    if (pathSegments.length === 0) {
      return yield* new PluginInstallError({
        url: url,
        cause: new Error(
          'URL has no repository path to derive a folder name from',
        ),
      });
    }

    return [hostLabel, ...pathSegments].join('-');
  });

export const cloneRepository = (
  url: string,
  destination: string,
): Effect.Effect<void, PluginInstallError> =>
  Effect.tryPromise({
    try: async () => {
      const clone = Bun.spawn(
        ['git', 'clone', '--depth', '1', url, destination],
        {
          stdout: 'ignore',
          stderr: 'pipe',
          env: { ...process.env, GIT_ALLOW_PROTOCOL: gitAllowProtocol },
        },
      );
      const exitCode = await clone.exited;

      if (exitCode !== 0) {
        const stderr = await Bun.readableStreamToText(clone.stderr);
        throw new Error(
          `git clone exited with code ${exitCode}${stderr.trim().length > 0 ? `: ${stderr.trim()}` : ''}`,
        );
      }
    },
    catch: (cause) => new PluginInstallError({ url: url, cause: cause }),
  });

/** Removes an incomplete or declined install without masking its original failure. */
export const removeFolder = (
  fileSystem: FileSystem.FileSystem,
  folderPath: string,
): Effect.Effect<void> =>
  fileSystem
    .remove(folderPath, { recursive: true, force: true })
    .pipe(Effect.ignore);

const readPackageName = (
  fileSystem: FileSystem.FileSystem,
  url: string,
  folderPath: string,
): Effect.Effect<Option.Option<string>, PluginInstallError> =>
  Effect.gen(function* () {
    const packageJsonPath = `${folderPath}/package.json`;
    const packageJsonExists = yield* fileSystem
      .exists(packageJsonPath)
      .pipe(
        Effect.mapError(
          (cause) => new PluginInstallError({ url: url, cause: cause }),
        ),
      );

    if (!packageJsonExists) {
      return Option.none();
    }

    const rawPackageJson = yield* fileSystem
      .readFileString(packageJsonPath)
      .pipe(
        Effect.mapError(
          (cause) => new PluginInstallError({ url: url, cause: cause }),
        ),
      );
    const parsedPackageJson = yield* decodePackageJson(rawPackageJson).pipe(
      Effect.mapError(
        (cause) => new PluginInstallError({ url: url, cause: cause }),
      ),
    );

    return typeof parsedPackageJson.name === 'string'
      ? Option.some(parsedPackageJson.name)
      : Option.none();
  });

export type PluginInstallResult = {
  url: string;
  folderPath: string;
  packageName: Option.Option<string>;
};

export const installPlugin = (
  url: string,
): Effect.Effect<
  PluginInstallResult,
  PluginInstallError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const folderName = yield* derivePluginFolderName(url);
    const pluginsDirectory = yield* getPluginsDirectoryPath.pipe(
      Effect.mapError(
        (cause) => new PluginInstallError({ url: url, cause: cause }),
      ),
    );
    const destination = `${pluginsDirectory}/${folderName}`;

    const alreadyExists = yield* fileSystem
      .exists(destination)
      .pipe(
        Effect.mapError(
          (cause) => new PluginInstallError({ url: url, cause: cause }),
        ),
      );

    if (alreadyExists) {
      return yield* new PluginInstallError({
        url: url,
        cause: new Error(`"${destination}" already exists; uninstall it first`),
      });
    }

    yield* fileSystem
      .makeDirectory(pluginsDirectory, { recursive: true })
      .pipe(
        Effect.mapError(
          (cause) => new PluginInstallError({ url: url, cause: cause }),
        ),
      );

    yield* cloneRepository(url, destination).pipe(
      Effect.tapError(() => removeFolder(fileSystem, destination)),
    );

    const packageName = yield* readPackageName(
      fileSystem,
      url,
      destination,
    ).pipe(Effect.tapError(() => removeFolder(fileSystem, destination)));

    return { url: url, folderPath: destination, packageName: packageName };
  });

export const validateInstalledPlugin = (
  fileSystem: FileSystem.FileSystem,
  loader: PluginLoader['Service'],
  installed: PluginInstallResult,
  existingPlugins: readonly DiscoveredPlugin[],
): Effect.Effect<DiscoveredPlugin, PluginInstallError> =>
  Effect.gen(function* () {
    const plugin = yield* loadPluginManifest(
      fileSystem,
      loader,
      installed.folderPath,
    ).pipe(
      Effect.mapError(
        (cause) => new PluginInstallError({ url: installed.url, cause: cause }),
      ),
    );

    const isDuplicate = existingPlugins.some(
      (existing) =>
        existing.folder !== installed.folderPath &&
        existing.manifest.name === plugin.manifest.name,
    );

    if (isDuplicate) {
      return yield* new PluginInstallError({
        url: installed.url,
        cause: new Error(
          `A plugin named "${plugin.manifest.name}" is already installed`,
        ),
      });
    }

    return plugin;
  });
