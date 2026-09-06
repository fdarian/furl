import type {
  ConfigField,
  DiscoveredPlugin,
  FurlConfig,
  KeychainError,
  SecretsService,
} from '@furl/core';
import {
  FurlConfigService,
  installPlugin,
  PluginDiscovery,
  PluginInstallError,
  PluginLoader,
  removeFolder,
  Secrets,
  validateInstalledPlugin,
} from '@furl/core';
import type { Terminal } from 'effect';
import { Console, Effect, FileSystem, Option, Redacted } from 'effect';
import { Argument, Command, Flag, Prompt } from 'effect/unstable/cli';

const isConfiguredValue = (
  value: Record<string, unknown> | false | undefined,
): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getPluginStatusTitle = (
  name: string,
  disabled: boolean,
  configured: boolean,
): string => {
  const state = disabled ? 'disabled' : 'enabled';
  return configured
    ? `${name}  (${state} · configured)`
    : `${name}  (${state})`;
};

const secretReferencePrefix = 'secret:';

/** Name a plugin field's keychain entry so two plugins with the same field key never collide. */
const secretNameFor = (pluginId: string, fieldKey: string): string =>
  `${pluginId}.${fieldKey}`;

/** Renders one manifest `config` field as a prompt; `None` means "leave the existing value untouched". */
const promptConfigField = (
  secrets: SecretsService,
  pluginId: string,
  field: ConfigField,
  existingValue: unknown,
): Effect.Effect<
  Option.Option<unknown>,
  KeychainError | Terminal.QuitError,
  Prompt.Environment
> =>
  Effect.gen(function* () {
    const label = field.label ?? field.key;
    const description = field.description ? ` — ${field.description}` : '';
    const optionalHint = field.required
      ? ''
      : ' (optional, press enter to skip)';
    const message = `${label}${description}${optionalHint}`;
    const validate = field.required
      ? (value: string) =>
          value.trim().length === 0
            ? Effect.fail('This field is required.')
            : Effect.succeed(value)
      : undefined;

    if (field.type === 'secret') {
      const entered = yield* Prompt.password({ message: message });
      const value = Redacted.value(entered);

      if (value.length === 0) {
        return Option.none();
      }

      const secretName = secretNameFor(pluginId, field.key);
      yield* secrets.set(secretName, value);
      return Option.some(`${secretReferencePrefix}${secretName}`);
    }

    if (field.type === 'boolean') {
      const initial =
        typeof existingValue === 'boolean' ? existingValue : false;
      const value = yield* Prompt.confirm({
        message: message,
        initial: initial,
      });
      return Option.some(value);
    }

    if (field.type === 'number') {
      const initial =
        typeof existingValue === 'number' ? existingValue : undefined;
      const value = yield* Prompt.integer({
        message: message,
        default: initial,
      });
      return Option.some(value);
    }

    if (field.type === 'enum') {
      const options = field.options ?? [];
      const skipChoice = { title: '(skip)', value: null } as const;
      const choices = field.required
        ? options.map((option) => ({ title: option, value: option }) as const)
        : [
            ...options.map(
              (option) => ({ title: option, value: option }) as const,
            ),
            skipChoice,
          ];
      const selected = yield* Prompt.select({
        message: message,
        choices: choices,
      });
      return selected === null ? Option.none() : Option.some(selected);
    }

    const initial =
      typeof existingValue === 'string' ? existingValue : undefined;
    const value = yield* Prompt.text({
      message: message,
      default: initial,
      validate: validate,
    });

    if (value.length === 0 && !field.required) {
      return Option.none();
    }

    return Option.some(value);
  });

const configurePlugin = (
  secrets: SecretsService,
  config: FurlConfig,
  plugin: DiscoveredPlugin,
): Effect.Effect<
  FurlConfig,
  KeychainError | Terminal.QuitError,
  Prompt.Environment
> =>
  Effect.gen(function* () {
    const fields = plugin.manifest.config ?? [];
    const existingRaw = config.plugins?.[plugin.manifest.name];
    const existingArgs = isConfiguredValue(existingRaw) ? existingRaw : {};
    const updatedArgs: Record<string, unknown> = { ...existingArgs };

    for (const field of fields) {
      const value = yield* promptConfigField(
        secrets,
        plugin.manifest.name,
        field,
        existingArgs[field.key],
      );

      if (Option.isSome(value)) {
        updatedArgs[field.key] = value.value;
      }
    }

    yield* Console.log(`Saved configuration for "${plugin.manifest.name}".`);

    return {
      ...config,
      plugins: { ...config.plugins, [plugin.manifest.name]: updatedArgs },
    };
  });

const togglePlugin = (
  config: FurlConfig,
  plugin: DiscoveredPlugin,
  currentlyDisabled: boolean,
): Effect.Effect<FurlConfig> =>
  Effect.gen(function* () {
    const plugins = { ...config.plugins };

    if (currentlyDisabled) {
      delete plugins[plugin.manifest.name];
    } else {
      plugins[plugin.manifest.name] = false;
    }

    yield* Console.log(
      `"${plugin.manifest.name}" is now ${currentlyDisabled ? 'enabled' : 'disabled'}.`,
    );

    return { ...config, plugins: plugins };
  });

const managePlugin = (
  secrets: SecretsService,
  config: FurlConfig,
  plugin: DiscoveredPlugin,
): Effect.Effect<
  FurlConfig,
  KeychainError | Terminal.QuitError,
  Prompt.Environment
> =>
  Effect.gen(function* () {
    const disabled = config.plugins?.[plugin.manifest.name] === false;
    const hasConfigurableFields = (plugin.manifest.config ?? []).length > 0;

    const action = yield* Prompt.select({
      message: `Manage "${plugin.manifest.name}"`,
      choices: [
        {
          title: disabled ? 'Enable' : 'Disable',
          value: 'toggle' as const,
        },
        ...(hasConfigurableFields
          ? [{ title: 'Configure', value: 'configure' as const }]
          : []),
        { title: 'Cancel', value: 'cancel' as const },
      ],
    });

    if (action === 'toggle') {
      return yield* togglePlugin(config, plugin, disabled);
    }

    if (action === 'configure') {
      return yield* configurePlugin(secrets, config, plugin);
    }

    return config;
  });

const runInteractivePluginsMenu = Effect.gen(function* () {
  const discovery = yield* PluginDiscovery;
  const configService = yield* FurlConfigService;
  const secrets = yield* Secrets;

  const plugins = yield* discovery.discover;

  if (plugins.length === 0) {
    yield* Console.log(
      'No plugins installed. Run `furl plugins install <git-url>` to add one.',
    );
    return;
  }

  const config = yield* configService.read;

  const choices = plugins.map((plugin) => {
    const disabled = config.plugins?.[plugin.manifest.name] === false;
    const configured = isConfiguredValue(
      config.plugins?.[plugin.manifest.name],
    );
    return {
      title: getPluginStatusTitle(plugin.manifest.name, disabled, configured),
      value: plugin as DiscoveredPlugin | 'exit',
    };
  });

  const selected = yield* Prompt.select({
    message: 'Select a plugin',
    choices: [...choices, { title: 'Exit', value: 'exit' as const }],
  });

  if (selected === 'exit') {
    return;
  }

  const updatedConfig = yield* managePlugin(secrets, config, selected);
  yield* configService.write(updatedConfig);
});

const installUrlArgument = Argument.string('url').pipe(
  Argument.withDescription('Git URL of the plugin repository to clone'),
);

const installYesFlag = Flag.boolean('yes').pipe(
  Flag.withDefault(false),
  Flag.withAlias('y'),
  Flag.withDescription(
    "Skip the confirmation prompt and run the plugin's code immediately; required in non-interactive sessions",
  ),
);

/**
 * `Prompt.confirm` reads keypresses from stdin; when stdin isn't a TTY (CI, a
 * pipe, `< /dev/null`) it never receives one and the whole command exits
 * silently instead of confirming or declining. Check this up front so a
 * non-interactive caller without `--yes` gets a clear error instead of an
 * unconfirmed install or a hang.
 */
const isInteractiveStdin = Effect.sync(() => process.stdin.isTTY === true);

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
          return yield* Effect.fail(
            new PluginInstallError({
              url: commandConfig.url,
              cause: new Error(
                "Refusing to run this plugin's code without confirmation in a non-interactive session; re-run with --yes to confirm.",
              ),
            }),
          );
        }

        const confirmed = yield* Prompt.confirm({
          message: `Continue installing "${displayName}"? This will run the plugin's code.`,
          initial: false,
        });

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
      );

      const plugin = yield* validateInstalledPlugin(
        fileSystem,
        loader,
        installed,
        existingPlugins,
      ).pipe(
        Effect.tapError(() => removeFolder(fileSystem, installed.folderPath)),
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

const uninstallIdArgument = Argument.string('id').pipe(
  Argument.withDescription('The installed plugin’s manifest name'),
);

export const pluginsUninstallCommand = Command.make(
  'uninstall',
  { id: uninstallIdArgument },
  (commandConfig) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const discovery = yield* PluginDiscovery;

      const plugins = yield* discovery.discover;
      const plugin = plugins.find(
        (candidate) => candidate.name === commandConfig.id,
      );

      if (plugin === undefined) {
        return yield* Effect.fail(
          new Error(`No installed plugin named "${commandConfig.id}".`),
        );
      }

      yield* fileSystem.remove(plugin.folder, { recursive: true });
      yield* Console.log(`Uninstalled "${plugin.name}" (${plugin.folder}).`);
    }),
).pipe(Command.withDescription('Remove an installed plugin'));

export const pluginsListCommand = Command.make('list', {}, () =>
  Effect.gen(function* () {
    const discovery = yield* PluginDiscovery;
    const configService = yield* FurlConfigService;

    const plugins = yield* discovery.discover;

    if (plugins.length === 0) {
      yield* Console.log(
        'No plugins installed. Run `furl plugins install <git-url>` to add one.',
      );
      return;
    }

    const config = yield* configService.read;

    for (const plugin of plugins) {
      const disabled = config.plugins?.[plugin.manifest.name] === false;
      const configured = isConfiguredValue(
        config.plugins?.[plugin.manifest.name],
      );
      const status = getPluginStatusTitle(
        plugin.manifest.name,
        disabled,
        configured,
      );
      yield* Console.log(`${status}  —  ${plugin.folder}`);
    }
  }),
).pipe(Command.withDescription('List installed plugins'));

export const pluginsCommand = Command.make(
  'plugins',
  {},
  () => runInteractivePluginsMenu,
).pipe(
  Command.withSubcommands([
    pluginsInstallCommand,
    pluginsUninstallCommand,
    pluginsListCommand,
  ]),
  Command.withDescription('Manage furl plugins'),
);
