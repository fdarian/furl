import { Furl } from '@furl/core';
import { Console, Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';
import { pluginsCommand } from './plugins';
import { providersCommand } from './providers';
import { secretsCommand } from './secrets';

const providerFlag = Flag.choice('provider', [
  'jina',
  'exa',
  'firecrawl',
] as const).pipe(
  Flag.optional,
  Flag.withAlias('p'),
  Flag.withDescription(
    'Deprecated: prepends default:<name> for this call. Use --plugin or the config "order" instead.',
  ),
);

const pluginFlag = Flag.string('plugin').pipe(
  Flag.optional,
  Flag.withDescription(
    'Force a single resolver id (a plugin name or a default:<name> built-in), bypassing the order chain',
  ),
);

const pluginsEnabledFlag = Flag.boolean('plugins').pipe(
  Flag.withDefault(true),
  Flag.withDescription(
    'Run discovered plugins ahead of the built-in chain (use --no-plugins to skip them)',
  ),
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
    plugin: pluginFlag,
    plugins: pluginsEnabledFlag,
  },
  (config) =>
    Effect.gen(function* () {
      if (Option.isNone(config.url)) {
        yield* Console.log(
          'Usage: furl <url> [--plugin <id>] [--no-plugins] [--provider jina|exa|firecrawl]',
        );
        yield* Console.log('       furl plugins');
        yield* Console.log('       furl secrets set <name>');
        yield* Console.log('       furl providers');
        return;
      }

      const furl = yield* Furl;
      const forcedResolverId = Option.isSome(config.plugin)
        ? config.plugin.value
        : Option.isSome(config.provider)
          ? config.provider.value
          : undefined;

      const result = yield* furl.fetch(config.url.value, {
        forcedResolverId: forcedResolverId,
        pluginsDisabled: !config.plugins,
      });

      yield* Console.log(result.markdown);
      yield* Console.error(`↳ via ${result.source}`);
    }),
).pipe(
  Command.withSubcommands([pluginsCommand, secretsCommand, providersCommand]),
  Command.withDescription('Fetch a URL and return LLM-optimized markdown'),
);
