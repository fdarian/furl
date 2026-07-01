import { Console, Context, Effect, FileSystem, Layer, Option } from 'effect';

import { getConfigDirectoryPath } from '../config-service.ts';
import { describeCause, PluginLoadError } from '../errors.ts';

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

const isReservedPluginName = (name: string): boolean =>
  name === '*' || name.startsWith('default:');

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

    return `${folderPath}/${parsedPackageJson.main}`;
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

    const match = manifest.match as { hostname?: unknown } | null | undefined;

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

    return manifest as unknown as PluginManifest;
  });

/** Loads a single plugin folder; on any failure, warns to stderr and yields `None` instead of aborting discovery. */
const discoverPluginFolder = (
  fileSystem: FileSystem.FileSystem,
  loader: PluginLoaderShape,
  pluginsDirectory: string,
  folderName: string,
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

    const entrypoint = yield* resolveEntrypoint(fileSystem, folderPath);
    const loaded = yield* loader.load(entrypoint);
    const manifest = yield* validateManifest(entrypoint, loaded);

    return Option.some<DiscoveredPlugin>({
      name: manifest.name,
      folder: folderPath,
      entrypoint: entrypoint,
      manifest: manifest,
    });
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

const discoverPlugins = (
  fileSystem: FileSystem.FileSystem,
  loader: PluginLoaderShape,
): Effect.Effect<DiscoveredPlugin[], PluginLoadError> =>
  Effect.gen(function* () {
    const configDirectory = yield* getConfigDirectoryPath.pipe(
      Effect.mapError(
        (cause) =>
          new PluginLoadError({ path: '~/.config/furl', cause: cause }),
      ),
    );
    const pluginsDirectory = `${configDirectory}/${pluginsDirectorySegment}`;
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
      discoverPluginFolder(fileSystem, loader, pluginsDirectory, folderName),
    );

    const plugins = discovered
      .filter(Option.isSome)
      .map((option) => option.value);

    return yield* dedupeByName(plugins);
  });

export type PluginDiscoveryShape = {
  /** Scans `~/.config/furl/plugins/` and returns every valid, uniquely-named plugin found. */
  discover: Effect.Effect<DiscoveredPlugin[], PluginLoadError>;
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
      discover: discoverPlugins(fileSystem, loader),
    };
  }),
);
