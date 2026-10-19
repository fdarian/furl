import type { DiscoveredPlugin, FurlConfig } from '@furl/core';
import {
  deleteGenericSecret,
  FurlConfigService,
  findPluginSecretNames,
  PluginDiscovery,
  removePluginConfig,
  Secrets,
  secretNameFor,
} from '@furl/core';
import { Console, Effect, FileSystem } from 'effect';
import { Argument, Command } from 'effect/unstable/cli';

const uninstallIdArgument = Argument.String('id').pipe(
  Argument.withDescription("The installed plugin's manifest name"),
);

/** Declared secret fields plus every `secret:<plugin>.*` reference in the plugin's saved config. */
export const secretNamesToDelete = (
  plugin: DiscoveredPlugin,
  config: FurlConfig,
): string[] => {
  const declared = (plugin.manifest.config ?? [])
    .filter((field) => field.type === 'secret')
    .map((field) => secretNameFor(plugin.name, field.key));
  const referenced = findPluginSecretNames(
    plugin.name,
    config.plugins?.[plugin.name],
  );

  return [...new Set([...declared, ...referenced])];
};

export const pluginsUninstallCommand = Command.make(
  'uninstall',
  { id: uninstallIdArgument },
  (commandConfig) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const discovery = yield* PluginDiscovery;
      const configService = yield* FurlConfigService;
      const secrets = yield* Secrets;

      const plugins = yield* discovery.discover;
      const plugin = plugins.find(
        (candidate) => candidate.name === commandConfig.id,
      );

      if (plugin === undefined) {
        return yield* Effect.fail(
          new Error(`No installed plugin named "${commandConfig.id}".`),
        );
      }

      const config = yield* configService.read;
      // Secrets go first: if deleting one fails the plugin stays installed, so
      // the uninstall can be retried instead of orphaning keychain entries.
      yield* Effect.forEach(secretNamesToDelete(plugin, config), (name) =>
        deleteGenericSecret(secrets, name),
      );
      yield* fileSystem.remove(plugin.folder, { recursive: true });
      yield* configService.write(removePluginConfig(config, plugin.name));
      yield* Console.log(`Uninstalled "${plugin.name}" (${plugin.folder}).`);
    }),
).pipe(Command.withDescription('Remove an installed plugin'));
