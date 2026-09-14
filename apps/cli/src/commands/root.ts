import { Furl } from '@furl/core';
import { Console, Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';
import { providersCommand } from './providers';

const providerFlag = Flag.Literals('provider', [
  'jina',
  'exa',
  'firecrawl',
] as const).pipe(
  Flag.optional,
  Flag.withAlias('p'),
  Flag.withDescription('Override the configured legacy fallback provider'),
);

const pluginFlag = Flag.String('plugin').pipe(
  Flag.optional,
  Flag.withDescription(
    'Force one order token: default:*, default:<builtin-name>, or plugin:<plugin-name>',
  ),
);

const pluginsEnabledFlag = Flag.Boolean('plugins').pipe(
  Flag.withDefault(true),
  Flag.withDescription('Discover plugins (use --no-plugins to skip them)'),
);

const urlArgument = Argument.String('url').pipe(
  Argument.optional,
  Argument.withDescription('URL to fetch'),
);

export const rootCommand = Command.make(
  'furl',
  {
    url: urlArgument,
    provider: providerFlag,
    plugin: pluginFlag,
    plugins: pluginsEnabledFlag,
  },
  (config) =>
    Effect.gen(function* () {
      if (Option.isNone(config.url)) {
        yield* Console.log(
          'Usage: furl <url> [--plugin <order-token>] [--no-plugins] [--provider jina|exa|firecrawl]',
        );
        yield* Console.log('       furl providers');
        return;
      }

      const furl = yield* Furl;
      const result = yield* furl.fetch(config.url.value, {
        pluginToken: Option.isSome(config.plugin)
          ? config.plugin.value
          : undefined,
        forcedProvider: Option.isSome(config.provider)
          ? config.provider.value
          : undefined,
        pluginsDisabled: !config.plugins,
      });

      yield* Console.log(result.markdown);
      yield* Console.error(`↳ via ${result.source}`);
    }),
).pipe(
  Command.withSubcommands([providersCommand]),
  Command.withDescription('Fetch a URL and return LLM-optimized markdown'),
);
