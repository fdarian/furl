import { Config, Effect, Option } from 'effect';
import type { ProviderName, Resolver } from 'furl-lib';
import { ProviderError, Resolvers } from 'furl-lib';

import type { SecretsService } from '../secrets-service.ts';
import { defaultOrderToken } from './order.ts';

/** Env var first, then the keychain account named after the provider. */
const providerApiKey = (
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

/** Built-in resolvers carrying their `default:<name>` order token as id. */
export const createDefaultResolvers = (secrets: SecretsService): Resolver[] => [
  { ...Resolvers.raw, id: defaultOrderToken('raw') },
  { ...Resolvers.direct, id: defaultOrderToken('direct') },
  { ...Resolvers.mdSuffix, id: defaultOrderToken('md-suffix') },
  {
    ...Resolvers.jina({
      apiKey: providerApiKey(secrets, 'jina', 'JINA_API_KEY'),
    }),
    id: defaultOrderToken('jina'),
  },
  {
    ...Resolvers.exa({ apiKey: providerApiKey(secrets, 'exa', 'EXA_API_KEY') }),
    id: defaultOrderToken('exa'),
  },
  {
    ...Resolvers.firecrawl({
      apiKey: providerApiKey(secrets, 'firecrawl', 'FIRECRAWL_API_KEY'),
    }),
    id: defaultOrderToken('firecrawl'),
  },
];
