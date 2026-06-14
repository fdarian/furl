import { Config, Effect, Option } from 'effect';

import { NoProviderKey, ProviderError } from '../errors.ts';
import type { ProviderName } from '../provider-name.ts';
import type { SecretsService } from '../secrets-service.ts';

const getSecretName = (provider: ProviderName): string => provider;

export const getOptionalProviderKey = (
  secrets: SecretsService,
  provider: ProviderName,
  environmentVariableName: string,
) =>
  Effect.gen(function* () {
    const configuredValue = yield* Config.string(environmentVariableName).pipe(
      Config.option,
      Effect.mapError(
        (cause) => new ProviderError({ provider: provider, cause: cause }),
      ),
    );

    if (Option.isSome(configuredValue)) {
      return configuredValue.value;
    }

    return yield* secrets.get(getSecretName(provider));
  });

export const getRequiredProviderKey = (
  secrets: SecretsService,
  provider: Exclude<ProviderName, 'jina'>,
  environmentVariableName: string,
) =>
  Effect.gen(function* () {
    const key = yield* getOptionalProviderKey(
      secrets,
      provider,
      environmentVariableName,
    );

    if (key === null) {
      return yield* Effect.fail(new NoProviderKey({ provider: provider }));
    }

    return key;
  });
