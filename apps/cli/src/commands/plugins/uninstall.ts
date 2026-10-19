import {
  FurlConfigService,
  PluginDiscovery,
  removePluginConfig,
} from '@furl/core';
import { Console, Effect, FileSystem } from 'effect';
import { Argument, Command } from 'effect/unstable/cli';

const uninstallIdArgument = Argument.String('id').pipe(
  Argument.withDescription("The installed plugin's manifest name"),
);

export const pluginsUninstallCommand = Command.make(
  'uninstall',
  { id: uninstallIdArgument },
  (commandConfig) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const discovery = yield* PluginDiscovery;
      const configService = yield* FurlConfigService;

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
      yield* fileSystem.remove(plugin.folder, { recursive: true });
      yield* configService.write(removePluginConfig(config, plugin.name));
      yield* Console.log(`Uninstalled "${plugin.name}" (${plugin.folder}).`);
    }),
).pipe(Command.withDescription('Remove an installed plugin'));
