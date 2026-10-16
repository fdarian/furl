import { Effect } from 'effect';

import { ResolverError } from '../errors.ts';
import type { SecretsService } from '../secrets-service.ts';

const secretReferencePrefix = 'secret:';

const resolveSecretReference = (
  secrets: SecretsService,
  pluginId: string,
  secretName: string,
): Effect.Effect<string, ResolverError> =>
  secrets.get(secretName).pipe(
    Effect.mapError(
      (cause) => new ResolverError({ id: pluginId, cause: cause }),
    ),
    Effect.flatMap((secretValue) =>
      secretValue === null
        ? Effect.fail(
            new ResolverError({
              id: pluginId,
              cause: new Error(
                `Missing secret "${secretName}" referenced by plugin config`,
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
): Effect.Effect<unknown, ResolverError> => {
  if (typeof value === 'string' && value.startsWith(secretReferencePrefix)) {
    return resolveSecretReference(
      secrets,
      pluginId,
      value.slice(secretReferencePrefix.length),
    );
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
): Effect.Effect<Record<string, unknown>, ResolverError> =>
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
