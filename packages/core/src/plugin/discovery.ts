import { Context, Effect, FileSystem, Layer, Schema } from 'effect';

import { getConfigDirectoryPath } from '../config-service.ts';
import { PluginLoadError } from '../errors.ts';

import { PluginLoader } from './loader.ts';
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

const packageJsonSchema = Schema.Struct({
  main: Schema.optional(Schema.Unknown),
});
const decodePackageJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(packageJsonSchema),
);

/** Rejects entrypoints whose symlinks or parent traversal leave the plugin folder. */
const resolveContainedEntrypoint = (
  fileSystem: FileSystem.FileSystem,
  folderPath: string,
  entrypointPath: string,
  outsideMessage: string,
): Effect.Effect<string, PluginLoadError> =>
  Effect.gen(function* () {
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
      return yield* new PluginLoadError({
        path: entrypointPath,
        cause: new Error(outsideMessage),
      });
    }

    return entrypointPath;
  });

/** Absolute path to `~/.config/furl/plugins`. */
export const getPluginsDirectoryPath = getConfigDirectoryPath.pipe(
  Effect.map(
    (configDirectoryPath) =>
      `${configDirectoryPath}/${pluginsDirectorySegment}`,
  ),
);

const isReservedPluginName = (name: string): boolean =>
  name === '*' || name.startsWith('default:');

const pluginNamePattern = /^[a-z0-9][a-z0-9_-]*$/;
const configFieldKeyPattern = /^[A-Za-z0-9_-]+$/;
const configFieldTypes: readonly unknown[] = [
  'string',
  'secret',
  'boolean',
  'number',
  'enum',
];

/** Returns a description of the first problem with the manifest's `config`, or undefined when it's valid. */
const findConfigProblem = (config: unknown): string | undefined => {
  if (config === undefined) {
    return undefined;
  }

  if (!Array.isArray(config)) {
    return 'Plugin manifest "config" must be an array';
  }

  for (const [index, field] of config.entries()) {
    if (typeof field !== 'object' || field === null) {
      return `Plugin manifest config[${index}] must be an object`;
    }

    const candidate = field as Record<string, unknown>;

    if (
      typeof candidate.key !== 'string' ||
      !configFieldKeyPattern.test(candidate.key)
    ) {
      return `Plugin manifest config[${index}] needs a "key" matching ${configFieldKeyPattern}`;
    }

    if (!configFieldTypes.includes(candidate.type)) {
      return `Plugin manifest config field "${candidate.key}" has an unknown "type"`;
    }

    if (candidate.type === 'enum') {
      const options = candidate.options;
      if (
        !Array.isArray(options) ||
        options.length === 0 ||
        !options.every(
          (option) => typeof option === 'string' && option.length > 0,
        )
      ) {
        return `Plugin manifest enum field "${candidate.key}" needs a non-empty "options" array of non-empty strings`;
      }
    }
  }

  return undefined;
};

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
      return yield* resolveContainedEntrypoint(
        fileSystem,
        folderPath,
        defaultEntrypointPath,
        `Entrypoint ("${defaultEntrypointPath}") resolves outside the plugin folder`,
      );
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
      return yield* new PluginLoadError({
        path: folderPath,
        cause: new Error(
          `No ${defaultEntrypointFileName} or ${packageJsonFileName}#main entrypoint found`,
        ),
      });
    }

    const rawPackageJson = yield* fileSystem
      .readFileString(packageJsonPath)
      .pipe(
        Effect.mapError(
          (cause) =>
            new PluginLoadError({ path: packageJsonPath, cause: cause }),
        ),
      );
    const parsedPackageJson = yield* decodePackageJson(rawPackageJson).pipe(
      Effect.mapError(
        (cause) => new PluginLoadError({ path: packageJsonPath, cause: cause }),
      ),
    );

    if (typeof parsedPackageJson.main !== 'string') {
      return yield* new PluginLoadError({
        path: packageJsonPath,
        cause: new Error(`${packageJsonFileName} is missing a "main" field`),
      });
    }

    const entrypointPath = `${folderPath}/${parsedPackageJson.main}`;
    return yield* resolveContainedEntrypoint(
      fileSystem,
      folderPath,
      entrypointPath,
      `${packageJsonFileName}#main ("${parsedPackageJson.main}") resolves outside the plugin folder`,
    );
  });

const validateManifest = (
  entrypointPath: string,
  candidate: unknown,
): Effect.Effect<PluginManifest, PluginLoadError> =>
  Effect.gen(function* () {
    if (typeof candidate !== 'object' || candidate === null) {
      return yield* new PluginLoadError({
        path: entrypointPath,
        cause: new Error(
          'Plugin entrypoint default export is not a manifest object',
        ),
      });
    }

    const manifest = candidate as Record<string, unknown>;

    if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
      return yield* new PluginLoadError({
        path: entrypointPath,
        cause: new Error('Plugin manifest is missing a "name"'),
      });
    }

    if (isReservedPluginName(manifest.name)) {
      return yield* new PluginLoadError({
        path: entrypointPath,
        cause: new Error(`Plugin name "${manifest.name}" is reserved`),
      });
    }

    if (!pluginNamePattern.test(manifest.name)) {
      return yield* new PluginLoadError({
        path: entrypointPath,
        cause: new Error(
          `Plugin name "${manifest.name}" must match ${pluginNamePattern}`,
        ),
      });
    }

    const configProblem = findConfigProblem(manifest.config);

    if (configProblem !== undefined) {
      return yield* new PluginLoadError({
        path: entrypointPath,
        cause: new Error(configProblem),
      });
    }

    if (typeof manifest.resolve !== 'function') {
      return yield* new PluginLoadError({
        path: entrypointPath,
        cause: new Error('Plugin manifest is missing a "resolve" function'),
      });
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
      return yield* new PluginLoadError({
        path: entrypointPath,
        cause: new Error('Plugin manifest is missing a valid "match.hostname"'),
      });
    }

    if (match.path !== undefined && typeof match.path !== 'string') {
      return yield* new PluginLoadError({
        path: entrypointPath,
        cause: new Error('Plugin manifest has an invalid "match.path"'),
      });
    }

    return manifest as unknown as PluginManifest;
  });

export const loadPluginManifest = (
  fileSystem: FileSystem.FileSystem,
  loader: PluginLoader['Service'],
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

export const getPluginFolderPath = (
  pluginsDirectory: string,
  name: string,
): string => `${pluginsDirectory}/${name}`;

/** Whether `name` is safe to use as a folder name under `plugins/` and as a `plugin:<name>` token. */
export const isValidPluginName = (name: string): boolean =>
  pluginNamePattern.test(name);

const readPluginsDirectoryPath = getPluginsDirectoryPath.pipe(
  Effect.mapError(
    (cause) =>
      new PluginLoadError({ path: '~/.config/furl/plugins', cause: cause }),
  ),
);

/** Imports `plugins/<name>/` and checks the manifest declares that same name. */
export const loadPluginByName = (
  fileSystem: FileSystem.FileSystem,
  loader: PluginLoader['Service'],
  name: string,
): Effect.Effect<DiscoveredPlugin, PluginLoadError> =>
  Effect.gen(function* () {
    const pluginsDirectory = yield* readPluginsDirectoryPath;
    const folderPath = getPluginFolderPath(pluginsDirectory, name);

    if (!isValidPluginName(name)) {
      return yield* new PluginLoadError({
        path: folderPath,
        cause: new Error(
          `Invalid plugin name "${name}" (must match ${pluginNamePattern})`,
        ),
      });
    }

    const folderExists = yield* fileSystem
      .exists(folderPath)
      .pipe(
        Effect.mapError(
          (cause) => new PluginLoadError({ path: folderPath, cause: cause }),
        ),
      );

    if (!folderExists) {
      return yield* new PluginLoadError({
        path: folderPath,
        cause: new Error(
          `Plugin "${name}" is listed in order but is not installed`,
        ),
      });
    }

    const plugin = yield* loadPluginManifest(fileSystem, loader, folderPath);

    if (plugin.name !== name) {
      return yield* new PluginLoadError({
        path: plugin.entrypoint,
        cause: new Error(
          `Plugin folder "${name}" declares the name "${plugin.name}"; the folder name must match the manifest name`,
        ),
      });
    }

    return plugin;
  });

/** Imports exactly the named plugin folders; unreferenced folders are never touched. */
export const discoverPlugins = (
  fileSystem: FileSystem.FileSystem,
  loader: PluginLoader['Service'],
  names: readonly string[],
): Effect.Effect<DiscoveredPlugin[], PluginLoadError> =>
  Effect.forEach([...new Set(names)], (name) =>
    loadPluginByName(fileSystem, loader, name),
  );

/** Names of the directories under `plugins/`, read without importing anything. */
export const listInstalledPluginNames = (
  fileSystem: FileSystem.FileSystem,
): Effect.Effect<string[], PluginLoadError> =>
  Effect.gen(function* () {
    const pluginsDirectory = yield* readPluginsDirectoryPath;
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
    const validEntries = entries.filter(isValidPluginName).sort();
    const directories = yield* Effect.forEach(validEntries, (name) =>
      fileSystem.stat(getPluginFolderPath(pluginsDirectory, name)).pipe(
        Effect.map((info) => info.type === 'Directory'),
        Effect.mapError(
          (cause) =>
            new PluginLoadError({
              path: getPluginFolderPath(pluginsDirectory, name),
              cause: cause,
            }),
        ),
      ),
    );

    return validEntries.filter((_name, index) => directories[index]);
  });

export class PluginDiscovery extends Context.Service<PluginDiscovery>()(
  'furl/plugin-discovery',
  {
    make: Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const loader = yield* PluginLoader;

      return {
        discover: (names: readonly string[]) =>
          discoverPlugins(fileSystem, loader, names),
        installedNames: listInstalledPluginNames(fileSystem),
      };
    }),
  },
) {
  static readonly layer = Layer.effect(PluginDiscovery, PluginDiscovery.make);
}
