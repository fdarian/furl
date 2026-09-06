import { Console, Context, Effect, FileSystem, Layer, Option } from 'effect';

import { getConfigDirectoryPath } from '../config-service.ts';
import { describeCause, PluginLoadError } from '../errors.ts';

import { defaultResolverNames } from './default/shared.ts';
import { PluginLoader, type PluginLoaderShape } from './loader.ts';
import type { PluginManifest } from './types.ts';

export type DiscoveredPlugin = {
  name: string;
  folder: string;
  entrypoint: string;
  manifest: PluginManifest;
};

const pluginsDirectorySegment = 'plugins';
const defaultEntrypointFileName = 'index.ts';
const packageJsonFileName = 'package.json';

/** Absolute path to `~/.config/furl/plugins` — where installed/hand-created plugin folders live. */
export const getPluginsDirectoryPath = getConfigDirectoryPath.pipe(
  Effect.map(
    (configDirectoryPath) =>
      `${configDirectoryPath}/${pluginsDirectorySegment}`,
  ),
);

/** Bare built-in resolver ids (`jina`, `raw`, ...) — reserved so a plugin can't shadow one under `order`'s single-id namespace; see `plugin/order.ts`. */
const reservedResolverNames: ReadonlySet<string> = new Set(
  defaultResolverNames,
);

const isReservedPluginName = (name: string): boolean =>
  name === '*' ||
  name.startsWith('default:') ||
  reservedResolverNames.has(name);

/** Resolves a plugin folder's entrypoint: `index.ts` by default, else `package.json#main`. */
const resolveEntrypoint = (
  fileSystem: FileSystem.FileSystem,
  folderPath: string,
): Effect.Effect<string, PluginLoadError> =>
  Effect.gen(function* () {
    const defaultEntrypointPath = `${folderPath}/${defaultEntrypointFileName}`;
    const defaultEntrypointExists = yield* fileSystem
      .exists(defaultEntrypointPath)
      .pipe(
        Effect.mapError(
          (cause) => new PluginLoadError({ path: folderPath, cause: cause }),
        ),
      );

    if (defaultEntrypointExists) {
      return defaultEntrypointPath;
    }

    const packageJsonPath = `${folderPath}/${packageJsonFileName}`;
    const packageJsonExists = yield* fileSystem
      .exists(packageJsonPath)
      .pipe(
        Effect.mapError(
          (cause) => new PluginLoadError({ path: folderPath, cause: cause }),
        ),
      );

    if (!packageJsonExists) {
      return yield* Effect.fail(
        new PluginLoadError({
          path: folderPath,
          cause: new Error(
            `No ${defaultEntrypointFileName} or ${packageJsonFileName}#main entrypoint found`,
          ),
        }),
      );
    }

    const rawPackageJson = yield* fileSystem
      .readFileString(packageJsonPath)
      .pipe(
        Effect.mapError(
          (cause) =>
            new PluginLoadError({ path: packageJsonPath, cause: cause }),
        ),
      );

    const parsedPackageJson = yield* Effect.try({
      try: () => JSON.parse(rawPackageJson) as { main?: unknown },
      catch: (cause) =>
        new PluginLoadError({ path: packageJsonPath, cause: cause }),
    });

    if (typeof parsedPackageJson.main !== 'string') {
      return yield* Effect.fail(
        new PluginLoadError({
          path: packageJsonPath,
          cause: new Error(`${packageJsonFileName} is missing a "main" field`),
        }),
      );
    }

    const entrypointPath = `${folderPath}/${parsedPackageJson.main}`;

    // `main` is attacker-controllable (it's the plugin's own package.json), so
    // a value like "../../../elsewhere/index.ts" — or a symlink planted under
    // the folder — could otherwise point the loader at a file outside the
    // plugin's installed folder. `realPath` resolves both `..` segments and
    // symlinks, so the containment check catches either escape route.
    const realFolderPath = yield* fileSystem
      .realPath(folderPath)
      .pipe(
        Effect.mapError(
          (cause) => new PluginLoadError({ path: folderPath, cause: cause }),
        ),
      );
    const realEntrypointPath = yield* fileSystem
      .realPath(entrypointPath)
      .pipe(
        Effect.mapError(
          (cause) =>
            new PluginLoadError({ path: entrypointPath, cause: cause }),
        ),
      );

    const isContained =
      realEntrypointPath === realFolderPath ||
      realEntrypointPath.startsWith(`${realFolderPath}/`);

    if (!isContained) {
      return yield* Effect.fail(
        new PluginLoadError({
          path: entrypointPath,
          cause: new Error(
            `${packageJsonFileName}#main ("${parsedPackageJson.main}") resolves outside the plugin folder`,
          ),
        }),
      );
    }

    return entrypointPath;
  });

/** Structurally validates a loaded module's default export as a `PluginManifest` and rejects reserved names. */
const validateManifest = (
  entrypointPath: string,
  candidate: unknown,
): Effect.Effect<PluginManifest, PluginLoadError> =>
  Effect.gen(function* () {
    if (typeof candidate !== 'object' || candidate === null) {
      return yield* Effect.fail(
        new PluginLoadError({
          path: entrypointPath,
          cause: new Error(
            'Plugin entrypoint default export is not a manifest object',
          ),
        }),
      );
    }

    const manifest = candidate as Record<string, unknown>;

    if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
      return yield* Effect.fail(
        new PluginLoadError({
          path: entrypointPath,
          cause: new Error('Plugin manifest is missing a "name"'),
        }),
      );
    }

    if (isReservedPluginName(manifest.name)) {
      return yield* Effect.fail(
        new PluginLoadError({
          path: entrypointPath,
          cause: new Error(`Plugin name "${manifest.name}" is reserved`),
        }),
      );
    }

    if (typeof manifest.resolve !== 'function') {
      return yield* Effect.fail(
        new PluginLoadError({
          path: entrypointPath,
          cause: new Error('Plugin manifest is missing a "resolve" function'),
        }),
      );
    }

    const match = manifest.match as
      | { hostname?: unknown; path?: unknown }
      | null
      | undefined;

    if (
      typeof match !== 'object' ||
      match === null ||
      typeof match.hostname !== 'string'
    ) {
      return yield* Effect.fail(
        new PluginLoadError({
          path: entrypointPath,
          cause: new Error(
            'Plugin manifest is missing a valid "match.hostname"',
          ),
        }),
      );
    }

    if (match.path !== undefined && typeof match.path !== 'string') {
      return yield* Effect.fail(
        new PluginLoadError({
          path: entrypointPath,
          cause: new Error('Plugin manifest has an invalid "match.path"'),
        }),
      );
    }

    return manifest as unknown as PluginManifest;
  });

/**
 * Loads and structurally validates a single plugin folder's manifest,
 * propagating `PluginLoadError` on any failure. Shared by directory-wide
 * discovery (which downgrades failures to a warning) and `furl plugins
 * install` (which wants a hard failure it can react to).
 */
export const loadPluginManifest = (
  fileSystem: FileSystem.FileSystem,
  loader: PluginLoaderShape,
  folderPath: string,
): Effect.Effect<DiscoveredPlugin, PluginLoadError> =>
  Effect.gen(function* () {
    const entrypoint = yield* resolveEntrypoint(fileSystem, folderPath);
    const loaded = yield* loader.load(entrypoint);
    const manifest = yield* validateManifest(entrypoint, loaded);

    return {
      name: manifest.name,
      folder: folderPath,
      entrypoint: entrypoint,
      manifest: manifest,
    };
  });

/**
 * Best-effort pre-import identity check for a plugin folder: its folder
 * name, or its package.json `name` (read as plain data, same as
 * `install.ts`'s installer-side check) — never its manifest `name`, since
 * that's a value passed to `definePlugin` inside the entrypoint itself and
 * is only known once that module has already run. `disabledPluginNames` is
 * keyed by manifest name (see `FurlConfigServiceShape.isPluginDisabled`), so
 * this only catches a disabled plugin whose on-disk names happen to match
 * it — the common case for a hand-authored plugin (folder named after
 * itself) or a git-installed one whose package.json `name` mirrors its
 * manifest `name`. A plugin disabled under a name that matches neither
 * still gets imported once; `buildResolverList` (see `plugin/order.ts`) is
 * what excludes it from the resolution chain in that case.
 */
const isDisabledBeforeImport = (
  fileSystem: FileSystem.FileSystem,
  folderName: string,
  folderPath: string,
  disabledPluginNames: ReadonlySet<string>,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (disabledPluginNames.size === 0) {
      return false;
    }

    if (disabledPluginNames.has(folderName)) {
      return true;
    }

    const packageJsonPath = `${folderPath}/${packageJsonFileName}`;
    const packageJsonExists = yield* fileSystem.exists(packageJsonPath);

    if (!packageJsonExists) {
      return false;
    }

    const rawPackageJson = yield* fileSystem.readFileString(packageJsonPath);
    const parsedPackageJson = JSON.parse(rawPackageJson) as { name?: unknown };

    return (
      typeof parsedPackageJson.name === 'string' &&
      disabledPluginNames.has(parsedPackageJson.name)
    );
  }).pipe(Effect.orElseSucceed(() => false));

/** Loads a single plugin folder; on any failure, warns to stderr and yields `None` instead of aborting discovery. */
const discoverPluginFolder = (
  fileSystem: FileSystem.FileSystem,
  loader: PluginLoaderShape,
  pluginsDirectory: string,
  folderName: string,
  disabledPluginNames: ReadonlySet<string>,
): Effect.Effect<Option.Option<DiscoveredPlugin>> =>
  Effect.gen(function* () {
    const folderPath = `${pluginsDirectory}/${folderName}`;
    const info = yield* fileSystem
      .stat(folderPath)
      .pipe(
        Effect.mapError(
          (cause) => new PluginLoadError({ path: folderPath, cause: cause }),
        ),
      );

    if (info.type !== 'Directory') {
      return Option.none<DiscoveredPlugin>();
    }

    const disabled = yield* isDisabledBeforeImport(
      fileSystem,
      folderName,
      folderPath,
      disabledPluginNames,
    );

    if (disabled) {
      return Option.none<DiscoveredPlugin>();
    }

    const plugin = yield* loadPluginManifest(fileSystem, loader, folderPath);

    return Option.some(plugin);
  }).pipe(
    Effect.catchTag('PluginLoadError', (error) =>
      Console.error(
        `↳ skipping plugin folder "${folderName}": ${describeCause(error.cause)}`,
      ).pipe(Effect.as(Option.none<DiscoveredPlugin>())),
    ),
  );

/** First plugin wins a name collision; later ones are dropped with a warning. */
const dedupeByName = (
  plugins: readonly DiscoveredPlugin[],
): Effect.Effect<DiscoveredPlugin[]> =>
  Effect.gen(function* () {
    const seen = new Map<string, DiscoveredPlugin>();

    for (const plugin of plugins) {
      const existing = seen.get(plugin.name);

      if (existing !== undefined) {
        yield* Console.error(
          `↳ duplicate plugin name "${plugin.name}" in "${plugin.folder}", ignoring (already loaded from "${existing.folder}")`,
        );
        continue;
      }

      seen.set(plugin.name, plugin);
    }

    return Array.from(seen.values());
  });

/** No folder is treated as pre-emptively disabled — the plain scan `discover` uses. */
const noDisabledPluginNames: ReadonlySet<string> = new Set();

/**
 * Scans the plugins directory, skipping any folder `isDisabledBeforeImport`
 * can identify as disabled before its entrypoint is ever loaded.
 */
export const discoverPlugins = (
  fileSystem: FileSystem.FileSystem,
  loader: PluginLoaderShape,
  disabledPluginNames: ReadonlySet<string>,
): Effect.Effect<DiscoveredPlugin[], PluginLoadError> =>
  Effect.gen(function* () {
    const pluginsDirectory = yield* getPluginsDirectoryPath.pipe(
      Effect.mapError(
        (cause) =>
          new PluginLoadError({ path: '~/.config/furl/plugins', cause: cause }),
      ),
    );
    const pluginsDirectoryExists = yield* fileSystem
      .exists(pluginsDirectory)
      .pipe(
        Effect.mapError(
          (cause) =>
            new PluginLoadError({ path: pluginsDirectory, cause: cause }),
        ),
      );

    if (!pluginsDirectoryExists) {
      return [];
    }

    const entries = yield* fileSystem
      .readDirectory(pluginsDirectory)
      .pipe(
        Effect.mapError(
          (cause) =>
            new PluginLoadError({ path: pluginsDirectory, cause: cause }),
        ),
      );

    const discovered = yield* Effect.forEach(entries, (folderName) =>
      discoverPluginFolder(
        fileSystem,
        loader,
        pluginsDirectory,
        folderName,
        disabledPluginNames,
      ),
    );

    const plugins = discovered
      .filter(Option.isSome)
      .map((option) => option.value);

    return yield* dedupeByName(plugins);
  });

export type PluginDiscoveryShape = {
  /**
   * Scans `~/.config/furl/plugins/` and returns every valid, uniquely-named
   * plugin found, regardless of disabled status. Used by management
   * commands (`furl plugins ...`) that need to show and toggle a disabled
   * plugin, not just the resolution path — those still import a disabled
   * plugin's entrypoint to learn its manifest name, same as before.
   */
  discover: Effect.Effect<DiscoveredPlugin[], PluginLoadError>;
  /**
   * Same as `discover`, but skips a folder `isDisabledBeforeImport` can
   * identify as disabled before importing it. Used by the resolution path
   * (`fetch-markdown.ts`), where running a disabled plugin's code at all —
   * not just excluding it from the chain — is the bug being fixed.
   */
  discoverEnabled: (
    disabledPluginNames: ReadonlySet<string>,
  ) => Effect.Effect<DiscoveredPlugin[], PluginLoadError>;
};

export class PluginDiscovery extends Context.Service<
  PluginDiscovery,
  PluginDiscoveryShape
>()('furl/plugin-discovery') {}

export const PluginDiscoveryLive = Layer.effect(
  PluginDiscovery,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const loader = yield* PluginLoader;

    return {
      discover: discoverPlugins(fileSystem, loader, noDisabledPluginNames),
      discoverEnabled: (disabledPluginNames: ReadonlySet<string>) =>
        discoverPlugins(fileSystem, loader, disabledPluginNames),
    };
  }),
);
