import type {
  ConfigField,
  DiscoveredPlugin,
  InvalidSecretError,
  KeychainError,
} from '@furl/core';
import {
  FurlConfigService,
  PluginDiscovery,
  Secrets,
  secretNameFor,
  secretReferencePrefix,
  setGenericSecret,
} from '@furl/core';
import type { Terminal } from 'effect';
import { Console, Effect, Option, Redacted } from 'effect';
import { Prompt } from 'effect/unstable/cli';

/** `None` means "leave the existing value untouched". */
const promptConfigField = (
  pluginId: string,
  field: ConfigField,
  existingValue: unknown,
): Effect.Effect<
  Option.Option<unknown>,
  KeychainError | InvalidSecretError | Terminal.QuitError,
  Secrets | Prompt.Environment
> =>
  Effect.gen(function* () {
    const label = field.label ?? field.key;
    const description = field.description ? ` - ${field.description}` : '';
    const optionalHint = field.required
      ? ''
      : ' (optional, press enter to skip)';
    const message = `${label}${description}${optionalHint}`;

    if (field.type === 'secret') {
      const secrets = yield* Secrets;
      const entered = yield* Prompt.Password({ message: message });
      const value = Redacted.value(entered);

      if (value.length === 0) {
        return Option.none();
      }

      const secretName = secretNameFor(pluginId, field.key);
      yield* setGenericSecret(secrets, secretName, value);
      return Option.some(`${secretReferencePrefix}${secretName}`);
    }

    if (field.type === 'boolean') {
      const value = yield* Prompt.Confirm({
        message: message,
        initial: typeof existingValue === 'boolean' ? existingValue : false,
      });
      return Option.some(value);
    }

    if (field.type === 'number') {
      const value = yield* Prompt.Int({
        message: message,
        default: typeof existingValue === 'number' ? existingValue : undefined,
      });
      return Option.some(value);
    }

    if (field.type === 'enum') {
      const choices = (field.options ?? []).map((option) => ({
        title: option,
        value: option as string | null,
      }));
      const selected = yield* Prompt.Select({
        message: message,
        choices: field.required
          ? choices
          : [...choices, { title: '(skip)', value: null }],
      });
      return selected === null ? Option.none() : Option.some(selected);
    }

    const value = yield* Prompt.String({
      message: message,
      default: typeof existingValue === 'string' ? existingValue : undefined,
      validate: field.required
        ? (input: string) =>
            input.trim().length === 0
              ? Effect.fail('This field is required.')
              : Effect.succeed(input)
        : undefined,
    });

    if (value.length === 0 && !field.required) {
      return Option.none();
    }

    return Option.some(value);
  });

const configurePlugin = (plugin: DiscoveredPlugin) =>
  Effect.gen(function* () {
    const configService = yield* FurlConfigService;
    const config = yield* configService.read;
    const existingArgs = config.plugins?.[plugin.name] ?? {};
    const updatedArgs: Record<string, unknown> = { ...existingArgs };

    for (const field of plugin.manifest.config ?? []) {
      const value = yield* promptConfigField(
        plugin.name,
        field,
        existingArgs[field.key],
      );

      if (Option.isSome(value)) {
        updatedArgs[field.key] = value.value;
      }
    }

    yield* configService.write({
      ...config,
      plugins: { ...config.plugins, [plugin.name]: updatedArgs },
    });
    yield* Console.log(`Saved configuration for "${plugin.name}".`);
  });

export const runConfigurePluginMenu = Effect.gen(function* () {
  const discovery = yield* PluginDiscovery;
  const plugins = yield* discovery.discover;
  const configurablePlugins = plugins.filter(
    (plugin) => (plugin.manifest.config ?? []).length > 0,
  );

  if (configurablePlugins.length === 0) {
    yield* Console.log(
      'No installed plugins have configurable fields. Run `furl plugins install <git-url>` to add one.',
    );
    return;
  }

  const selected = yield* Prompt.Select({
    message: 'Select a plugin to configure',
    choices: [
      ...configurablePlugins.map((plugin) => ({
        title: plugin.name,
        value: plugin as DiscoveredPlugin | null,
      })),
      { title: 'Exit', value: null },
    ],
  });

  if (selected === null) {
    return;
  }

  yield* configurePlugin(selected);
});
