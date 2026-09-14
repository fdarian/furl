import { Furl } from '@furl/core';
import { Console, Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';
import { providersCommand } from './providers';

const splitResolverTokens = (value: string): readonly string[] => {
  const tokens = value.split(',').map((token) => token.trim());

  if (tokens.some((token) => token.length === 0)) {
    throw new Error(
      '--resolvers entries must be non-empty comma-separated order tokens',
    );
  }

  return tokens;
};

const resolversFlag = Flag.String('resolvers').pipe(
  Flag.mapTryCatch(splitResolverTokens, (cause) =>
    cause instanceof Error ? cause.message : String(cause),
  ),
  Flag.optional,
  Flag.withDescription(
    'Override order with comma-separated tokens: default:*, default:<builtin-name>, or plugin:<plugin-name>',
  ),
);

const urlArgument = Argument.String('url').pipe(
  Argument.optional,
  Argument.withDescription('URL to fetch'),
);

export const rootCommand = Command.make(
  'furl',
  {
    url: urlArgument,
    resolvers: resolversFlag,
  },
  (config) =>
    Effect.gen(function* () {
      if (Option.isNone(config.url)) {
        yield* Console.log('Usage: furl <url> [--resolvers <tokens>]');
        yield* Console.log('       furl providers');
        return;
      }

      const furl = yield* Furl;
      const result = yield* furl.fetch(config.url.value, {
        resolvers: Option.isSome(config.resolvers)
          ? config.resolvers.value
          : undefined,
      });

      yield* Console.log(result.markdown);
      yield* Console.error(`↳ via ${result.source}`);
    }),
).pipe(
  Command.withSubcommands([providersCommand]),
  Command.withDescription('Fetch a URL and return LLM-optimized markdown'),
);
