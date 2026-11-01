import { Config, Effect, Option } from 'effect';

import { NoProviderKey, ProviderError } from '../errors.ts';
import type { ProviderName } from '../provider-name.ts';

/**
 * A literal key, or an effect evaluated on every run. `None` means no key is
 * configured. Failures of the effect surface as the resolver's failure cause.
 */
export type ApiKey = string | Effect.Effect<Option.Option<string>, unknown>;

export type ApiKeyOptions = {
  /** When omitted, the provider's environment variable is read through `Config`. */
  apiKey?: ApiKey;
};

export const getOptionalProviderKey = (
  provider: ProviderName,
  environmentVariableName: string,
  apiKey: ApiKey | undefined,
): Effect.Effect<Option.Option<string>, unknown> => {
  if (typeof apiKey === 'string') {
    return Effect.succeed(Option.some(apiKey));
  }

  if (apiKey !== undefined) {
    return apiKey;
  }

  return Config.String(environmentVariableName).pipe(
    Config.option,
    Effect.mapError(
      (cause) => new ProviderError({ provider: provider, cause: cause }),
    ),
  );
};

export const getRequiredProviderKey = (
  provider: Exclude<ProviderName, 'jina'>,
  environmentVariableName: string,
  apiKey: ApiKey | undefined,
): Effect.Effect<string, unknown> =>
  Effect.gen(function* () {
    const key = yield* getOptionalProviderKey(
      provider,
      environmentVariableName,
      apiKey,
    );

    if (Option.isNone(key)) {
      return yield* new NoProviderKey({ provider: provider });
    }

    return key.value;
  });
