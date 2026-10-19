import type {
  ConfigField,
  DiscoveredPlugin,
  InvalidSecretError,
  KeychainError,
} from '@furl/core';
import {
  FurlConfigService,
  getGenericSecret,
  PluginDiscovery,
  Secrets,
  secretNameFor,
  secretReferencePrefix,
  setGenericSecret,
} from '@furl/core';
import type { Terminal } from 'effect';
import { Console, Effect, Option, Redacted } from 'effect';
import { Prompt } from 'effect/unstable/cli';
import {
  enumChoices,
  fieldMessage,
  intPromptOptions,
  optionalBooleanChoices,
  optionalNumberPromptOptions,
  parseOptionalNumber,
  passwordPromptOptions,
  stringPromptOptions,
} from './configure-prompts';

type PromptedField = {
  value: unknown;
  /** Written to the keychain only once every field has been answered. */
  secret?: { name: string; value: string };
};

const hasStoredSecret = (
  secrets: Secrets['Service'],
  existingValue: unknown,
) =>
  typeof existingValue === 'string' &&
  existingValue.startsWith(secretReferencePrefix)
    ? getGenericSecret(
        secrets,
        existingValue.slice(secretReferencePrefix.length),
      ).pipe(Effect.map((stored) => stored !== null))
    : Effect.succeed(false);

/** `None` means "leave the existing value untouched". */
const promptConfigField = (
  pluginId: string,
  field: ConfigField,
  existingValue: unknown,
): Effect.Effect<
  Option.Option<PromptedField>,
  KeychainError | InvalidSecretError | Terminal.QuitError,
  Secrets | Prompt.Environment
> =>
  Effect.gen(function* () {
    if (field.type === 'secret') {
      const secrets = yield* Secrets;
      const stored = yield* hasStoredSecret(secrets, existingValue);
      const entered = yield* Prompt.Password(
        passwordPromptOptions(
          fieldMessage(field, stored),
          field.required === true && !stored,
        ),
      );
      const value = Redacted.value(entered);

      if (value.length === 0) {
        return Option.none();
      }

      const secretName = secretNameFor(pluginId, field.key);
      return Option.some({
        value: `${secretReferencePrefix}${secretName}`,
        secret: { name: secretName, value: value },
      });
    }

    const message = fieldMessage(field, false);

    if (field.type === 'boolean') {
      if (field.required) {
        const value = yield* Prompt.Confirm({
          message: message,
          initial: typeof existingValue === 'boolean' ? existingValue : false,
        });
        return Option.some({ value: value });
      }

      const selected = yield* Prompt.Select({
        message: message,
        choices: optionalBooleanChoices,
      });
      return selected === null
        ? Option.none()
        : Option.some({ value: selected });
    }

    if (field.type === 'number') {
      if (field.required) {
        const value = yield* Prompt.Int(
          intPromptOptions(message, existingValue),
        );
        return Option.some({ value: value });
      }

      const input = yield* Prompt.String(
        optionalNumberPromptOptions(message, existingValue),
      );
      return Option.map(parseOptionalNumber(input), (value) => ({
        value: value,
      }));
    }

    if (field.type === 'enum') {
      const selected = yield* Prompt.Select({
        message: message,
        choices: enumChoices(field, existingValue),
      });
      return selected === null
        ? Option.none()
        : Option.some({ value: selected });
    }

    const value = yield* Prompt.String(
      stringPromptOptions(message, field, existingValue),
    );

    if (value.length === 0 && !field.required) {
      return Option.none();
    }

    return Option.some({ value: value });
  });

const configurePlugin = (plugin: DiscoveredPlugin) =>
  Effect.gen(function* () {
    const configService = yield* FurlConfigService;
    const secrets = yield* Secrets;
    const config = yield* configService.read;
    const existingArgs = config.plugins?.[plugin.name] ?? {};
    const updatedArgs: Record<string, unknown> = { ...existingArgs };
    const pendingSecrets: Array<{ name: string; value: string }> = [];

    for (const field of plugin.manifest.config ?? []) {
      const prompted = yield* promptConfigField(
        plugin.name,
        field,
        existingArgs[field.key],
      );

      if (Option.isSome(prompted)) {
        updatedArgs[field.key] = prompted.value.value;
        if (prompted.value.secret !== undefined) {
          pendingSecrets.push(prompted.value.secret);
        }
      }
    }

    yield* Effect.forEach(pendingSecrets, (pending) =>
      setGenericSecret(secrets, pending.name, pending.value),
    );
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
