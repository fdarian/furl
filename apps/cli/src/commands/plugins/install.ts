import {
  type FurlConfig,
  FurlConfigService,
  insertPluginToken,
  installPlugin,
  PluginDiscovery,
  PluginInstallError,
  PluginLoader,
  removeFolder,
  validateInstalledPlugin,
} from '@furl/core';
import { Console, Effect, FileSystem, Option } from 'effect';
import { Argument, Command, Flag, Prompt } from 'effect/unstable/cli';

const installUrlArgument = Argument.String('url').pipe(
  Argument.withDescription('Git URL of the plugin repository to clone'),
);

const installYesFlag = Flag.Boolean('yes').pipe(
  Flag.withDefault(false),
  Flag.withAlias('y'),
  Flag.withDescription(
    "Skip the confirmation prompt and run the plugin's code immediately; required in non-interactive sessions",
  ),
);

const isInteractiveStdin = Effect.sync(() => process.stdin.isTTY === true);

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

export const pluginsInstallCommand = Command.make(
  'install',
  { url: installUrlArgument, yes: installYesFlag },
  (commandConfig) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const loader = yield* PluginLoader;
      const discovery = yield* PluginDiscovery;

      const installed = yield* installPlugin(commandConfig.url);
      const displayName = Option.getOrElse(
        installed.packageName,
        () => installed.folderPath,
      );

      yield* Console.log(`Cloned "${displayName}" to ${installed.folderPath}.`);

      if (!commandConfig.yes) {
        const interactive = yield* isInteractiveStdin;

        if (!interactive) {
          yield* removeFolder(fileSystem, installed.folderPath);
          return yield* new PluginInstallError({
            url: commandConfig.url,
            cause: new Error(
              "Refusing to run this plugin's code without confirmation in a non-interactive session; re-run with --yes to confirm.",
            ),
          });
        }

        const confirmed = yield* Prompt.Confirm({
          message: `Continue installing "${displayName}"? This will run the plugin's code.`,
          initial: false,
        }).pipe(
          Effect.tapError(() => removeFolder(fileSystem, installed.folderPath)),
        );

        if (!confirmed) {
          yield* removeFolder(fileSystem, installed.folderPath);
          yield* Console.log('Install cancelled.');
          return;
        }
      }

      const existingPlugins = yield* discovery.discover.pipe(
        Effect.mapError(
          (cause) =>
            new PluginInstallError({ url: commandConfig.url, cause: cause }),
        ),
        Effect.tapError(() => removeFolder(fileSystem, installed.folderPath)),
      );

      const plugin = yield* validateInstalledPlugin(
        fileSystem,
        loader,
        installed,
        existingPlugins,
      ).pipe(
        Effect.tapError(() => removeFolder(fileSystem, installed.folderPath)),
      );

      const configService = yield* FurlConfigService;
      const config = yield* configService.read;
      const order = yield* configService.resolveOrder;
      yield* configService.write(
        registerInstalledPlugin(config, order, plugin.manifest.name),
      );

      yield* Console.log(
        `Installed "${plugin.manifest.name}" to ${installed.folderPath}.`,
      );
    }),
).pipe(
  Command.withDescription(
    'Clone a plugin repository into the plugins directory',
  ),
);
