import type {
  ConfigField,
  DiscoveredPlugin,
  FurlConfig,
  KeychainError,
  SecretsService,
} from '@furl/core';
import {
  FurlConfigService,
  getPluginsDirectoryPath,
  loadPluginManifest,
  PluginDiscovery,
  PluginInstallError,
  PluginLoader,
  Secrets,
} from '@furl/core';
import type { Terminal } from 'effect';
import { Console, Effect, FileSystem, Option, Redacted } from 'effect';
import { Argument, Command, Prompt } from 'effect/unstable/cli';

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

const derivePluginFolderName = (
  url: string,
): Effect.Effect<string, PluginInstallError> =>
  Effect.gen(function* () {
    const parsedUrl = yield* Effect.try({
      try: () => new URL(url),
      catch: (cause) => new PluginInstallError({ url: url, cause: cause }),
    });
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

const cloneRepository = (
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

/** Best-effort cleanup after a failed install; never masks the original error. */
const removeFolder = (
  fileSystem: FileSystem.FileSystem,
  folderPath: string,
): Effect.Effect<void> =>
  fileSystem
    .remove(folderPath, { recursive: true, force: true })
    .pipe(Effect.ignore);

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

export const pluginsInstallCommand = Command.make(
  'install',
  { url: installUrlArgument },
  (commandConfig) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const loader = yield* PluginLoader;
      const discovery = yield* PluginDiscovery;

      const pluginsDirectory = yield* getPluginsDirectoryPath.pipe(
        Effect.mapError(
          (cause) =>
            new PluginInstallError({ url: commandConfig.url, cause: cause }),
        ),
      );
      const folderName = yield* derivePluginFolderName(commandConfig.url);
      const destination = `${pluginsDirectory}/${folderName}`;

      const alreadyExists = yield* fileSystem
        .exists(destination)
        .pipe(
          Effect.mapError(
            (cause) =>
              new PluginInstallError({ url: commandConfig.url, cause: cause }),
          ),
        );

      if (alreadyExists) {
        return yield* Effect.fail(
          new PluginInstallError({
            url: commandConfig.url,
            cause: new Error(
              `"${destination}" already exists; uninstall it first`,
            ),
          }),
        );
      }

      const existingPlugins = yield* discovery.discover.pipe(
        Effect.mapError(
          (cause) =>
            new PluginInstallError({ url: commandConfig.url, cause: cause }),
        ),
      );

      yield* fileSystem
        .makeDirectory(pluginsDirectory, { recursive: true })
        .pipe(
          Effect.mapError(
            (cause) =>
              new PluginInstallError({ url: commandConfig.url, cause: cause }),
          ),
        );

      yield* cloneRepository(commandConfig.url, destination);

      const installed = yield* loadPluginManifest(
        fileSystem,
        loader,
        destination,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new PluginInstallError({ url: commandConfig.url, cause: cause }),
        ),
        Effect.tapError(() => removeFolder(fileSystem, destination)),
      );

      const isDuplicate = existingPlugins.some(
        (plugin) => plugin.manifest.name === installed.manifest.name,
      );

      if (isDuplicate) {
        yield* removeFolder(fileSystem, destination);
        return yield* Effect.fail(
          new PluginInstallError({
            url: commandConfig.url,
            cause: new Error(
              `A plugin named "${installed.manifest.name}" is already installed`,
            ),
          }),
        );
      }

      yield* Console.log(
        `Installed "${installed.manifest.name}" to ${destination}.`,
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
        yield* Console.error(
          `No installed plugin named "${commandConfig.id}".`,
        );
        return;
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
