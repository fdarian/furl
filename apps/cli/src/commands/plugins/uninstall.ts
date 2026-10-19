import { PluginManager } from '@furl/core';
import { Console, Effect } from 'effect';
import { Argument, Command } from 'effect/unstable/cli';

const uninstallNameArgument = Argument.String('name').pipe(
  Argument.withDescription("The installed plugin's name (its folder name)"),
);

export const pluginsUninstallCommand = Command.make(
  'uninstall',
  { name: uninstallNameArgument },
  (commandConfig) =>
    Effect.gen(function* () {
      const manager = yield* PluginManager;
      const result = yield* manager.uninstall(commandConfig.name);

      yield* Console.log(
        result.folderRemoved
          ? `Uninstalled "${result.name}" (${result.folder}).`
          : `Removed "${result.name}" from the config; its folder (${result.folder}) was already gone.`,
      );
    }),
).pipe(Command.withDescription('Remove an installed plugin'));
