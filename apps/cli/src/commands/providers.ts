import type { ProviderName } from '@furl/core';
import { FurlConfigService, providerOrderToken, Secrets } from '@furl/core';
import { Console, Effect, Option, Redacted } from 'effect';
import { Command, Prompt } from 'effect/unstable/cli';

/** Puts `provider`'s `default:` token at the front of `order`, moving it there if already present. */
const withProviderFirst = (
  order: readonly string[],
  provider: ProviderName,
): string[] => {
  const token = providerOrderToken(provider);
  return [token, ...order.filter((entry) => entry !== token)];
};

const getProviderStatusTitle = (
  provider: 'jina' | 'exa' | 'firecrawl',
  isDefault: boolean,
  keyIsSet: boolean,
): string => {
  if (provider === 'jina') {
    if (isDefault) {
      return keyIsSet
        ? 'jina  (default · key set for higher limits)'
        : 'jina  (default · keyless)';
    }

    return keyIsSet ? 'jina  (key set for higher limits)' : 'jina  (keyless)';
  }

  if (provider === 'exa') {
    if (isDefault) {
      return keyIsSet ? 'exa  (default · key set)' : 'exa  (default · not set)';
    }

    return keyIsSet ? 'exa  (key set)' : 'exa  (not set)';
  }

  if (isDefault) {
    return keyIsSet
      ? 'firecrawl  (default · key set)'
      : 'firecrawl  (default · not set)';
  }

  return keyIsSet ? 'firecrawl  (key set)' : 'firecrawl  (not set)';
};

/** Writes `provider`'s `default:` token to the front of `order`, preserving the rest of the config. */
const putProviderFirst = (provider: ProviderName) =>
  Effect.gen(function* () {
    const configService = yield* FurlConfigService;
    const config = yield* configService.read;
    const order = yield* configService.resolveOrder;
    yield* configService.write({
      order: withProviderFirst(order, provider),
      plugins: config.plugins,
    });
  });

const setDefaultProvider = (provider: ProviderName) =>
  Effect.gen(function* () {
    yield* putProviderFirst(provider);
    yield* Console.log(`${provider} is now your default provider.`);
  });

const saveProviderKey = (provider: 'exa' | 'firecrawl') =>
  Effect.gen(function* () {
    const secrets = yield* Secrets;
    const key = yield* Prompt.password({
      message: `Enter ${provider} API key:`,
    });
    yield* secrets.set(provider, Redacted.value(key));
    yield* Console.log(`Saved ${provider} key.`);
    yield* setDefaultProvider(provider);
  });

const manageConfiguredProvider = (provider: 'exa' | 'firecrawl') =>
  Effect.gen(function* () {
    const secrets = yield* Secrets;
    const config = yield* FurlConfigService;
    const activeProvider = yield* config.resolveProvider(Option.none());
    const action = yield* Prompt.select({
      message: `Manage ${provider}`,
      choices: [
        { title: 'Set as default', value: 'default' as const },
        { title: 'Replace key', value: 'replace' as const },
        { title: 'Delete key', value: 'delete' as const },
        { title: 'Cancel', value: 'cancel' as const },
      ],
    });

    if (action === 'default') {
      yield* setDefaultProvider(provider);
      return;
    }

    if (action === 'replace') {
      yield* saveProviderKey(provider);
      return;
    }

    if (action === 'delete') {
      const confirmed = yield* Prompt.confirm({
        message: `Delete ${provider} key?`,
        initial: false,
      });

      if (confirmed) {
        yield* secrets.delete(provider);
        yield* Console.log(`Deleted ${provider} key.`);

        if (activeProvider === provider) {
          yield* putProviderFirst('jina');
          yield* Console.log(
            'jina is now your default provider because the active provider key was deleted.',
          );
        }
      }
    }
  });

const manageJinaProvider = () =>
  Effect.gen(function* () {
    const secrets = yield* Secrets;
    const existingKey = yield* secrets.get('jina');
    const action = yield* Prompt.select({
      message:
        'Jina is keyless by default. Manage an optional key for higher limits?',
      choices:
        existingKey === null
          ? [
              { title: 'Set as default', value: 'default' as const },
              { title: 'Set key', value: 'set' as const },
              { title: 'Skip', value: 'skip' as const },
            ]
          : [
              { title: 'Set as default', value: 'default' as const },
              { title: 'Replace key', value: 'replace' as const },
              { title: 'Delete key', value: 'delete' as const },
              { title: 'Cancel', value: 'cancel' as const },
            ],
    });

    if (action === 'default') {
      yield* setDefaultProvider('jina');
      return;
    }

    if (action === 'set' || action === 'replace') {
      const key = yield* Prompt.password({
        message: 'Enter jina API key:',
      });
      yield* secrets.set('jina', Redacted.value(key));
      yield* Console.log('Saved jina key.');
      return;
    }

    if (action === 'delete') {
      const confirmed = yield* Prompt.confirm({
        message: 'Delete jina key?',
        initial: false,
      });

      if (confirmed) {
        yield* secrets.delete('jina');
        yield* Console.log('Deleted jina key.');
      }
    }
  });

export const providersCommand = Command.make('providers', {}, () =>
  Effect.gen(function* () {
    const secrets = yield* Secrets;
    const config = yield* FurlConfigService;
    const activeProvider = yield* config.resolveProvider(Option.none());
    const jinaKey = yield* secrets.get('jina');
    const exaKey = yield* secrets.get('exa');
    const firecrawlKey = yield* secrets.get('firecrawl');
    const provider = yield* Prompt.select({
      message: 'Select a provider',
      choices: [
        {
          title: getProviderStatusTitle(
            'jina',
            activeProvider === 'jina',
            jinaKey !== null,
          ),
          value: 'jina' as const,
        },
        {
          title: getProviderStatusTitle(
            'exa',
            activeProvider === 'exa',
            exaKey !== null,
          ),
          value: 'exa' as const,
        },
        {
          title: getProviderStatusTitle(
            'firecrawl',
            activeProvider === 'firecrawl',
            firecrawlKey !== null,
          ),
          value: 'firecrawl' as const,
        },
        {
          title: 'Exit',
          value: 'exit' as const,
        },
      ],
    });

    if (provider === 'exit') {
      return;
    }

    if (provider === 'jina') {
      yield* manageJinaProvider();
      return;
    }

    const existingKey = yield* secrets.get(provider);

    if (existingKey === null) {
      yield* saveProviderKey(provider);
      return;
    }

    yield* manageConfiguredProvider(provider);
  }),
).pipe(Command.withDescription('Configure provider API keys'));
