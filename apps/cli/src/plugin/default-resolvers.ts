import { Config, Effect, Option } from 'effect';
import type { ProviderName, Resolver } from 'furl-core';
import { ProviderError, Resolvers } from 'furl-core';

import { MissingProviderKeyError } from '../errors.ts';
import type { SecretsService } from '../secrets-service.ts';
import { defaultOrderToken } from './order.ts';

/** Env var first, then the keychain account named after the provider. */
const lookupProviderApiKey = (
  secrets: SecretsService,
  provider: ProviderName,
  environmentVariableName: string,
) =>
  Effect.gen(function* () {
    const configured = yield* Config.String(environmentVariableName).pipe(
      Config.option,
      Effect.mapError(
        (cause) => new ProviderError({ provider: provider, cause: cause }),
      ),
    );

    if (Option.isSome(configured)) {
      return configured;
    }

    return Option.fromNullishOr(yield* secrets.get(provider));
  });

/** Same lookup, but a missing key fails with the CLI's hint to run `furl providers`. */
const requiredProviderApiKey = (
  secrets: SecretsService,
  provider: ProviderName,
  environmentVariableName: string,
) =>
  Effect.gen(function* () {
    const key = yield* lookupProviderApiKey(
      secrets,
      provider,
      environmentVariableName,
    );

    if (Option.isNone(key)) {
      return yield* new MissingProviderKeyError({ provider: provider });
    }

    return key;
  });

/** Built-in resolvers carrying their `default:<name>` order token as id. */
export const createDefaultResolvers = (secrets: SecretsService): Resolver[] => [
  { ...Resolvers.raw, id: defaultOrderToken('raw') },
  { ...Resolvers.direct, id: defaultOrderToken('direct') },
  { ...Resolvers.mdSuffix, id: defaultOrderToken('md-suffix') },
  {
    ...Resolvers.jina({
      apiKey: lookupProviderApiKey(secrets, 'jina', 'JINA_API_KEY'),
    }),
    id: defaultOrderToken('jina'),
  },
  {
    ...Resolvers.exa({
      apiKey: requiredProviderApiKey(secrets, 'exa', 'EXA_API_KEY'),
    }),
    id: defaultOrderToken('exa'),
  },
  {
    ...Resolvers.firecrawl({
      apiKey: requiredProviderApiKey(secrets, 'firecrawl', 'FIRECRAWL_API_KEY'),
    }),
    id: defaultOrderToken('firecrawl'),
  },
];
