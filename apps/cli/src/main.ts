#!/usr/bin/env bun

import { BunRuntime, BunServices } from '@effect/platform-bun';
import {
  Furl,
  FurlConfigServiceLive,
  FurlLive,
  Secrets,
  SecretsLive,
} from '@furl/core';
import { Console, Effect, Layer, Option, Redacted } from 'effect';
import { Argument, Command, Flag, Prompt } from 'effect/unstable/cli';
import { FetchHttpClient } from 'effect/unstable/http';

const providerFlag = Flag.choice('provider', [
  'jina',
  'exa',
  'firecrawl',
] as const).pipe(
  Flag.optional,
  Flag.withAlias('p'),
  Flag.withDescription('Override the configured fallback provider'),
);

const urlArgument = Argument.string('url').pipe(
  Argument.optional,
  Argument.withDescription('URL to fetch'),
);

const saveProviderKey = (provider: 'exa' | 'firecrawl') =>
  Effect.gen(function* () {
    const secrets = yield* Secrets;
    const key = yield* Prompt.password({
      message: `Enter ${provider} API key:`,
    });
    yield* secrets.set(provider, Redacted.value(key));
    yield* Console.log(`Saved ${provider} key.`);
  });

const manageConfiguredProvider = (provider: 'exa' | 'firecrawl') =>
  Effect.gen(function* () {
    const secrets = yield* Secrets;
    const action = yield* Prompt.select({
      message: `Manage ${provider} key`,
      choices: [
        { title: 'Replace key', value: 'replace' as const },
        { title: 'Delete key', value: 'delete' as const },
        { title: 'Cancel', value: 'cancel' as const },
      ],
    });

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
              { title: 'Set key', value: 'set' as const },
              { title: 'Skip', value: 'skip' as const },
            ]
          : [
              { title: 'Replace key', value: 'replace' as const },
              { title: 'Delete key', value: 'delete' as const },
              { title: 'Cancel', value: 'cancel' as const },
            ],
    });

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

const providersCommand = Command.make('providers', {}, () =>
  Effect.gen(function* () {
    const secrets = yield* Secrets;
    const jinaKey = yield* secrets.get('jina');
    const exaKey = yield* secrets.get('exa');
    const firecrawlKey = yield* secrets.get('firecrawl');
    const provider = yield* Prompt.select({
      message: 'Select a provider',
      choices: [
        {
          title:
            jinaKey === null
              ? 'jina (default · keyless)'
              : 'jina (default · key set for higher limits)',
          value: 'jina' as const,
        },
        {
          title: exaKey === null ? 'exa — not set' : 'exa ✓ configured',
          value: 'exa' as const,
        },
        {
          title:
            firecrawlKey === null
              ? 'firecrawl — not set'
              : 'firecrawl ✓ configured',
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

const rootCommand = Command.make(
  'furl',
  {
    url: urlArgument,
    provider: providerFlag,
  },
  (config) =>
    Effect.gen(function* () {
      if (Option.isNone(config.url)) {
        yield* Console.log('Usage: furl <url> [--provider jina|exa|firecrawl]');
        yield* Console.log('       furl providers');
        return;
      }

      const furl = yield* Furl;
      const result = Option.isSome(config.provider)
        ? yield* furl.fetchWithProvider(config.url.value, config.provider.value)
        : yield* furl.fetch(config.url.value);

      yield* Console.log(result.markdown);
      yield* Console.error(`↳ via ${result.source}`);
    }),
).pipe(
  Command.withSubcommands([providersCommand]),
  Command.withDescription('Fetch a URL and return LLM-optimized markdown'),
);

const configLayer = FurlConfigServiceLive.pipe(
  Layer.provide(BunServices.layer),
);

const furlLayer = FurlLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      BunServices.layer,
      FetchHttpClient.layer,
      SecretsLive,
      configLayer,
    ),
  ),
);

const appLayer = Layer.mergeAll(BunServices.layer, SecretsLive, furlLayer);

const program = Command.run(rootCommand, {
  version: '0.1.0',
}).pipe(Effect.provide(appLayer));

BunRuntime.runMain(program);
