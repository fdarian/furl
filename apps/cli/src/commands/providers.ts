import type { FurlConfig, ProviderName } from '@furl/core';
import {
  FurlConfigService,
  insertProviderToken,
  providerOrderToken,
  removeProviderToken,
  Secrets,
} from '@furl/core';
import { Console, Effect, Option, Redacted } from 'effect';
import { Command, Prompt } from 'effect/unstable/cli';

export const warnLegacyProvider = (config: FurlConfig) => {
  if (config.provider === undefined) {
    return Effect.void;
  }

  return Console.error(
    `↳ config.json's "provider" field ("${config.provider}") is deprecated; use the "order" field instead ("order" takes precedence when both are present). Run \`furl providers\` to persist the migration and drop the field.`,
  );
};

const getProviderStatusTitle = (
  provider: ProviderName,
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

export const validateProviderKey = (value: string) =>
  value.trim().length === 0
    ? Effect.fail('API key cannot be empty')
    : Effect.succeed(value);

const promptProviderKey = (provider: ProviderName) =>
  Prompt.Password({
    message: `Enter ${provider} API key:`,
    validate: validateProviderKey,
  });

export const migrateLegacyProvider = (config: FurlConfig) =>
  Effect.gen(function* () {
    if (config.provider === undefined) {
      return;
    }

    const configService = yield* FurlConfigService;
    yield* configService.write(config);
    yield* Console.log(
      `Migrated config.json's legacy "provider" field ("${config.provider}") to "order".`,
    );
  });

const putProviderInOrder = (provider: ProviderName) =>
  Effect.gen(function* () {
    const configService = yield* FurlConfigService;
    const config = yield* configService.read;
    const order = yield* configService.resolveOrder;
    yield* configService.write({
      ...config,
      order: insertProviderToken(order, provider),
    });
  });

export const removeProviderFromOrder = (provider: ProviderName) =>
  Effect.gen(function* () {
    const configService = yield* FurlConfigService;
    const config = yield* configService.read;
    const order = yield* configService.resolveOrder;
    const nextOrder = removeProviderToken(order, provider);

    if (nextOrder.length === order.length) {
      return;
    }

    if (nextOrder.length === 0) {
      const remaining: FurlConfig = { ...config };
      delete remaining.order;
      yield* configService.write(remaining);
      yield* Console.log(
        `Removed ${provider} from your resolver order. The order is now empty, so the default order ("default:*") applies.`,
      );
      return;
    }

    yield* configService.write({ ...config, order: nextOrder });
    yield* Console.log(`Removed ${provider} from your resolver order.`);
  });

export const hintIfJinaNotInOrder = () =>
  Effect.gen(function* () {
    const configService = yield* FurlConfigService;
    const order = yield* configService.resolveOrder;

    if (!order.includes(providerOrderToken('jina'))) {
      yield* Console.log(
        'Hint: default:jina is not in your resolver order, so the key will not be used. Choose "Set as default" for jina to add it.',
      );
    }
  });

const setDefaultProvider = (provider: ProviderName) =>
  Effect.gen(function* () {
    yield* putProviderInOrder(provider);
    yield* Console.log(`${provider} is now your default provider.`);
  });

const saveProviderKey = (provider: 'exa' | 'firecrawl') =>
  Effect.gen(function* () {
    const secrets = yield* Secrets;
    const key = yield* promptProviderKey(provider);
    yield* secrets.set(provider, Redacted.value(key));
    yield* Console.log(`Saved ${provider} key.`);
    yield* setDefaultProvider(provider);
  });

const manageConfiguredProvider = (provider: 'exa' | 'firecrawl') =>
  Effect.gen(function* () {
    const secrets = yield* Secrets;
    const action = yield* Prompt.Select({
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
      const confirmed = yield* Prompt.Confirm({
        message: `Delete ${provider} key?`,
        initial: false,
      });

      if (confirmed) {
        yield* secrets.delete(provider);
        yield* Console.log(`Deleted ${provider} key.`);
        yield* removeProviderFromOrder(provider);
      }
    }
  });

const manageJinaProvider = () =>
  Effect.gen(function* () {
    const secrets = yield* Secrets;
    const existingKey = yield* secrets.get('jina');
    const action = yield* Prompt.Select({
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
      const key = yield* promptProviderKey('jina');
      yield* secrets.set('jina', Redacted.value(key));
      yield* Console.log('Saved jina key.');
      yield* hintIfJinaNotInOrder();
      return;
    }

    if (action === 'delete') {
      const confirmed = yield* Prompt.Confirm({
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
    const configValue = yield* config.read;
    yield* migrateLegacyProvider(configValue);
    const activeProvider = yield* config.resolveProvider;
    const jinaKey = yield* secrets.get('jina');
    const exaKey = yield* secrets.get('exa');
    const firecrawlKey = yield* secrets.get('firecrawl');
    const provider = yield* Prompt.Select({
      message: 'Select a provider',
      choices: [
        {
          title: getProviderStatusTitle(
            'jina',
            Option.isSome(activeProvider) && activeProvider.value === 'jina',
            jinaKey !== null,
          ),
          value: 'jina' as const,
        },
        {
          title: getProviderStatusTitle(
            'exa',
            Option.isSome(activeProvider) && activeProvider.value === 'exa',
            exaKey !== null,
          ),
          value: 'exa' as const,
        },
        {
          title: getProviderStatusTitle(
            'firecrawl',
            Option.isSome(activeProvider) &&
              activeProvider.value === 'firecrawl',
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
