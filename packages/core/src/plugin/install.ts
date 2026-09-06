import { Effect, FileSystem, Option } from 'effect';

import { PluginInstallError } from '../errors.ts';

import type { DiscoveredPlugin } from './discovery.ts';
import { getPluginsDirectoryPath, loadPluginManifest } from './discovery.ts';
import type { PluginLoaderShape } from './loader.ts';

/**
 * Git transports this CLI will clone over. Excludes `ext:`/`file:`/etc —
 * git's `ext::` transport spawns an arbitrary shell command, and
 * `new URL(...)` parses it without complaint (empty hostname, non-empty
 * pathname), so the scheme has to be checked explicitly before anything
 * is spawned.
 */
const allowedUrlSchemes = new Set(['https:', 'ssh:', 'git:']);

/** Matches `allowedUrlSchemes`; passed to `git clone` as a second, spawn-level guard against protocol redirection mid-clone. */
const gitAllowProtocol = 'https:ssh:git';

const parseAllowedGitUrl = (
  url: string,
): Effect.Effect<URL, PluginInstallError> =>
  Effect.gen(function* () {
    const parsedUrl = yield* Effect.try({
      try: () => new URL(url),
      catch: (cause) => new PluginInstallError({ url: url, cause: cause }),
    });

    if (!allowedUrlSchemes.has(parsedUrl.protocol)) {
      return yield* Effect.fail(
        new PluginInstallError({
          url: url,
          cause: new Error(
            `Unsupported URL scheme "${parsedUrl.protocol}" — only https:, ssh:, and git: are allowed`,
          ),
        }),
      );
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
      return yield* Effect.fail(
        new PluginInstallError({
          url: url,
          cause: new Error(
            'URL has no repository path to derive a folder name from',
          ),
        }),
      );
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
        const stderr = await new Response(clone.stderr).text();
        throw new Error(
          `git clone exited with code ${exitCode}${stderr.trim().length > 0 ? `: ${stderr.trim()}` : ''}`,
        );
      }
    },
    catch: (cause) => new PluginInstallError({ url: url, cause: cause }),
  });

/** Best-effort cleanup after a failed or declined install; never masks the original error. */
export const removeFolder = (
  fileSystem: FileSystem.FileSystem,
  folderPath: string,
): Effect.Effect<void> =>
  fileSystem
    .remove(folderPath, { recursive: true, force: true })
    .pipe(Effect.ignore);

/**
 * Reads `package.json#name` as plain data — no import — so the install flow
 * can tell the user what they're about to run before any of the plugin's
 * own code executes. A missing file or missing/non-string `name` just means
 * nothing to show; the entrypoint load behind confirmation is what actually
 * validates the plugin.
 */
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

    const parsedPackageJson = yield* Effect.try({
      try: () => JSON.parse(rawPackageJson) as { name?: unknown },
      catch: (cause) => new PluginInstallError({ url: url, cause: cause }),
    });

    return typeof parsedPackageJson.name === 'string'
      ? Option.some(parsedPackageJson.name)
      : Option.none();
  });

/** What lands on disk after `installPlugin`, before its code has ever run. */
export type PluginInstallResult = {
  url: string;
  folderPath: string;
  packageName: Option.Option<string>;
};

/**
 * Clones a plugin repository and reports what landed — never importing the
 * clone's own code. Callers decide whether/how to confirm with a human
 * before passing the result to `validateInstalledPlugin`, which is the step
 * that actually runs the plugin's entrypoint.
 */
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
      return yield* Effect.fail(
        new PluginInstallError({
          url: url,
          cause: new Error(
            `"${destination}" already exists; uninstall it first`,
          ),
        }),
      );
    }

    yield* fileSystem
      .makeDirectory(pluginsDirectory, { recursive: true })
      .pipe(
        Effect.mapError(
          (cause) => new PluginInstallError({ url: url, cause: cause }),
        ),
      );

    yield* cloneRepository(url, destination);

    const packageName = yield* readPackageName(fileSystem, url, destination);

    return { url: url, folderPath: destination, packageName: packageName };
  });

/**
 * Loads and structurally validates the plugin cloned by `installPlugin` —
 * the step that dynamically imports the plugin's own entrypoint — and
 * rejects it if another installed plugin already uses the same manifest
 * name. Callers are expected to gate this behind an explicit human
 * confirmation, since it executes third-party code.
 */
export const validateInstalledPlugin = (
  fileSystem: FileSystem.FileSystem,
  loader: PluginLoaderShape,
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
      (existing) => existing.manifest.name === plugin.manifest.name,
    );

    if (isDuplicate) {
      return yield* Effect.fail(
        new PluginInstallError({
          url: installed.url,
          cause: new Error(
            `A plugin named "${plugin.manifest.name}" is already installed`,
          ),
        }),
      );
    }

    return plugin;
  });
