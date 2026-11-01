import { Console, Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import { Furl } from 'furl-lib';
import { FurlConfigService } from '../config-service';
import { PluginDiscovery } from '../plugin/discovery';
import { loadResolvers } from '../plugin/load-resolvers';
import { Secrets } from '../secrets-service';
import { pluginsCommand } from './plugins/root';
import { providersCommand, warnLegacyProvider } from './providers';
import { secretsCommand } from './secrets/root';

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
        yield* Console.log('       furl plugins');
        yield* Console.log('       furl secrets set <name>');
        yield* Console.log('       furl providers');
        return;
      }

      const configService = yield* FurlConfigService;

      if (Option.isNone(config.resolvers)) {
        const configValue = yield* configService.read;
        yield* warnLegacyProvider(configValue);
      }

      const resolvers = yield* loadResolvers(
        configService,
        yield* Secrets,
        yield* PluginDiscovery,
        Option.getOrUndefined(config.resolvers),
      );
      const result = yield* Furl.fetch(config.url.value, {
        resolvers: resolvers,
      });

      yield* Console.log(result.markdown);
      yield* Console.error(`↳ via ${result.source}`);
    }),
).pipe(
  Command.withSubcommands([pluginsCommand, secretsCommand, providersCommand]),
  Command.withDescription('Fetch a URL and return LLM-optimized markdown'),
);
