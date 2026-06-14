import { Furl } from '@furl/core';
import { Console, Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';
import { providersCommand } from './providers';

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

export const rootCommand = Command.make(
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
