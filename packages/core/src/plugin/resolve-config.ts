import { Effect } from 'effect';

import type { KeychainError } from '../errors.ts';
import { ConfigError, InvalidSecretError } from '../errors.ts';
import type { SecretsService } from '../secrets-service.ts';

export const secretReferencePrefix = 'secret:';

const genericSecretNamespace = 'secret/';

/** Names a plugin field's secret so two plugins with the same field key never collide. */
export const secretNameFor = (pluginId: string, fieldKey: string): string =>
  `${pluginId}.${fieldKey}`;

/** Keychain account of a generic secret, kept apart from provider keys (`exa`, `firecrawl`, `jina`). */
export const genericSecretAccount = (name: string): string =>
  `${genericSecretNamespace}${name}`;

export const setGenericSecret = (
  secrets: SecretsService,
  name: string,
  value: string,
): Effect.Effect<void, KeychainError | InvalidSecretError> => {
  if (name.trim().length === 0) {
    return Effect.fail(
      new InvalidSecretError({ reason: 'Secret name must not be empty' }),
    );
  }

  // Bun.secrets.set treats "" as a delete.
  if (value.length === 0) {
    return Effect.fail(
      new InvalidSecretError({ reason: 'Secret value must not be empty' }),
    );
  }

  return secrets.set(genericSecretAccount(name), value);
};

export const deleteGenericSecret = (
  secrets: SecretsService,
  name: string,
): Effect.Effect<boolean, KeychainError> =>
  secrets.delete(genericSecretAccount(name));

export const getGenericSecret = (
  secrets: SecretsService,
  name: string,
): Effect.Effect<string | null, KeychainError> =>
  secrets.get(genericSecretAccount(name));

/** Deep-walks a config value, collecting the names of `secret:<pluginId>.*` references. */
export const findPluginSecretNames = (
  pluginId: string,
  value: unknown,
): string[] => {
  const ownPrefix = `${secretReferencePrefix}${pluginId}.`;

  if (typeof value === 'string') {
    return value.startsWith(ownPrefix)
      ? [value.slice(secretReferencePrefix.length)]
      : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => findPluginSecretNames(pluginId, item));
  }

  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap((item) =>
      findPluginSecretNames(pluginId, item),
    );
  }

  return [];
};

const resolveSecretReference = (
  secrets: SecretsService,
  pluginId: string,
  secretName: string,
): Effect.Effect<string, ConfigError> =>
  getGenericSecret(secrets, secretName).pipe(
    Effect.mapError(
      (cause) =>
        new ConfigError({
          cause: new Error(
            `Cannot read secret "${secretName}" referenced by plugin "${pluginId}": ${cause.message}`,
          ),
        }),
    ),
    Effect.flatMap((secretValue) =>
      secretValue === null
        ? Effect.fail(
            new ConfigError({
              cause: new Error(
                `Missing secret "${secretName}" referenced by plugin "${pluginId}" config`,
              ),
            }),
          )
        : Effect.succeed(secretValue),
    ),
  );

/** Deep-walks a config value, resolving any `secret:<name>` string into its keychain value. */
const resolveValue = (
  secrets: SecretsService,
  pluginId: string,
  value: unknown,
): Effect.Effect<unknown, ConfigError> => {
  if (typeof value === 'string' && value.startsWith(secretReferencePrefix)) {
    const secretName = value.slice(secretReferencePrefix.length);

    if (secretName.trim().length === 0) {
      return Effect.fail(
        new ConfigError({
          cause: new Error(
            `Empty secret reference "${value}" in plugin "${pluginId}" config`,
          ),
        }),
      );
    }

    return resolveSecretReference(secrets, pluginId, secretName);
  }

  if (Array.isArray(value)) {
    return Effect.forEach(value, (item) =>
      resolveValue(secrets, pluginId, item),
    );
  }

  if (value !== null && typeof value === 'object') {
    return Effect.forEach(Object.entries(value), ([key, item]) =>
      resolveValue(secrets, pluginId, item).pipe(
        Effect.map((resolved) => [key, resolved] as const),
      ),
    ).pipe(Effect.map((entries) => Object.fromEntries(entries)));
  }

  return Effect.succeed(value);
};

/** Deep-resolves `secret:<name>` string values in a plugin's config args before invoking `resolve`. */
export const resolvePluginConfig = (
  secrets: SecretsService,
  pluginId: string,
  args: Record<string, unknown> | undefined,
): Effect.Effect<Record<string, unknown>, ConfigError> =>
  Effect.gen(function* () {
    if (args === undefined) {
      return {};
    }

    const entries = yield* Effect.forEach(
      Object.entries(args),
      ([key, value]) =>
        resolveValue(secrets, pluginId, value).pipe(
          Effect.map((resolved) => [key, resolved] as const),
        ),
    );

    return Object.fromEntries(entries);
  });
