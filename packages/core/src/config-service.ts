import {
  Console,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Schema,
} from 'effect';

import { ConfigError } from './errors.ts';
import type { ProviderName } from './provider-name.ts';
import { providerSchema } from './provider-name.ts';

const pluginConfigValueSchema = Schema.Union([
  Schema.Record(Schema.String, Schema.Unknown),
  Schema.Literal(false),
]);

const furlConfigSchema = Schema.Struct({
  provider: Schema.optional(providerSchema),
  order: Schema.optional(Schema.Array(Schema.String)),
  plugins: Schema.optional(
    Schema.Record(Schema.String, pluginConfigValueSchema),
  ),
});

/** A plugin's config overlay value: its args object, or `false` to disable it. */
export type PluginConfigValue = Record<string, unknown> | false;

export type FurlConfig = {
  provider?: ProviderName | undefined;
  order?: readonly string[] | undefined;
  plugins?: Readonly<Record<string, PluginConfigValue>> | undefined;
};

/**
 * `jina`/`exa`/`firecrawl` hit third-party APIs, so they're opt-in: add
 * `default:jina` (or `default:*`) to `order`, or pass `--plugin jina`, to
 * bring them back.
 */
const defaultOrder: readonly string[] = [
  '*',
  'default:raw',
  'default:direct',
  'default:md-suffix',
];

const defaultOrderTokenPrefix = 'default:';

/** The `order` token naming a provider's built-in resolver, e.g. `"default:firecrawl"`. */
export const providerOrderToken = (provider: ProviderName): string =>
  `${defaultOrderTokenPrefix}${provider}`;

/** `providerSchema`'s literals — every id `resolveProvider` recognizes as a "provider" token in `order`. */
const providerNames: readonly ProviderName[] = ['jina', 'exa', 'firecrawl'];

/**
 * `config.provider` predates the `order`-based resolver chain and is never
 * read by the fetch path anymore (see `fetchMarkdown` in
 * `fetch-markdown.ts`). Rather than silently ignore it — leaving a config
 * field upgraders already have set with no effect — fold it into `order`
 * for this run and tell them to persist the migration.
 */
const migrateLegacyProvider = (
  legacyProvider: ProviderName,
  order: readonly string[] | undefined,
): readonly string[] => {
  const token = providerOrderToken(legacyProvider);
  const baseOrder = order ?? defaultOrder;
  return baseOrder.includes(token) ? baseOrder : [token, ...baseOrder];
};

const decodeConfig = Schema.decodeUnknownEffect(furlConfigSchema);

const configDirectoryName = '.config/furl';
const configFileName = 'config.json';

const getHomeDirectory = Effect.sync(() => process.env.HOME).pipe(
  Effect.flatMap((homeDirectory) =>
    homeDirectory === undefined
      ? Effect.fail(new ConfigError({ cause: new Error('HOME is not set') }))
      : Effect.succeed(homeDirectory),
  ),
);

/** Absolute path to `~/.config/furl` — the base directory for config.json and the plugins dir. */
export const getConfigDirectoryPath = getHomeDirectory.pipe(
  Effect.map((homeDirectory) => `${homeDirectory}/${configDirectoryName}`),
);

const getConfigFilePath = getConfigDirectoryPath.pipe(
  Effect.map(
    (configDirectoryPath) => `${configDirectoryPath}/${configFileName}`,
  ),
);

export class FurlConfigService extends Context.Service<
  FurlConfigService,
  FurlConfigServiceShape
>()('furl/config') {}

export interface FurlConfigServiceShape {
  read: Effect.Effect<FurlConfig, ConfigError>;
  resolveProvider: (
    providerOverride: Option.Option<ProviderName>,
  ) => Effect.Effect<ProviderName, ConfigError>;
  /** The resolver precedence chain, defaulting to `defaultOrder`. */
  resolveOrder: Effect.Effect<readonly string[], ConfigError>;
  /** The args overlay for a plugin, or `false` if disabled, or `undefined` if absent. */
  pluginArgs: (
    id: string,
  ) => Effect.Effect<PluginConfigValue | undefined, ConfigError>;
  isPluginDisabled: (id: string) => Effect.Effect<boolean, ConfigError>;
  write: (config: FurlConfig) => Effect.Effect<void, ConfigError>;
}

export const FurlConfigServiceLive = Layer.effect(
  FurlConfigService,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const read = Effect.gen(function* () {
      const configFilePath = yield* getConfigFilePath;
      const configFileExists = yield* fileSystem
        .exists(configFilePath)
        .pipe(Effect.mapError((cause) => new ConfigError({ cause: cause })));

      if (!configFileExists) {
        return {};
      }

      const rawConfig = yield* fileSystem
        .readFileString(configFilePath)
        .pipe(Effect.mapError((cause) => new ConfigError({ cause: cause })));
      const parsedConfig = yield* Effect.try({
        try: () => JSON.parse(rawConfig),
        catch: (cause) => new ConfigError({ cause: cause }),
      });

      const decoded = yield* decodeConfig(parsedConfig).pipe(
        Effect.mapError((cause) => new ConfigError({ cause: cause })),
      );

      if (decoded.provider === undefined) {
        return decoded;
      }

      yield* Console.error(
        `↳ config.json's "provider" field ("${decoded.provider}") is deprecated and no longer read by the fetch chain; using it as "${providerOrderToken(decoded.provider)}" in "order" for this run. Run \`furl providers\` to persist the migration and drop the field.`,
      );

      return {
        order: migrateLegacyProvider(decoded.provider, decoded.order),
        plugins: decoded.plugins,
      };
    });

    return {
      read: read,
      /**
       * "Active provider" for `furl providers`' own display purposes: the
       * first of jina/exa/firecrawl's `default:` tokens found in `order`
       * (see `providerOrderToken`), since setting one as default now means
       * putting its token at the front of the chain. Falls back to `jina`
       * when none are configured — a label only, since an opt-in provider
       * absent from `order` still won't run.
       */
      resolveProvider: (providerOverride: Option.Option<ProviderName>) =>
        Effect.gen(function* () {
          if (Option.isSome(providerOverride)) {
            return providerOverride.value;
          }

          const config = yield* read;
          const order = config.order ?? defaultOrder;
          const providerTokens = new Map(
            providerNames.map(
              (provider) => [providerOrderToken(provider), provider] as const,
            ),
          );

          for (const token of order) {
            const provider = providerTokens.get(token);
            if (provider !== undefined) {
              return provider;
            }
          }

          return 'jina';
        }),
      resolveOrder: Effect.gen(function* () {
        const config = yield* read;
        return config.order ?? defaultOrder;
      }),
      pluginArgs: (id: string) =>
        Effect.gen(function* () {
          const config = yield* read;
          return config.plugins?.[id];
        }),
      isPluginDisabled: (id: string) =>
        Effect.gen(function* () {
          const config = yield* read;
          return config.plugins?.[id] === false;
        }),
      write: (config: FurlConfig) =>
        Effect.gen(function* () {
          const configFilePath = yield* getConfigFilePath;
          const lastSlashIndex = configFilePath.lastIndexOf('/');
          const configDirectoryPath = configFilePath.slice(0, lastSlashIndex);
          yield* fileSystem
            .makeDirectory(configDirectoryPath, { recursive: true })
            .pipe(
              Effect.mapError((cause) => new ConfigError({ cause: cause })),
            );
          const json = yield* Effect.try({
            try: () => JSON.stringify(config, null, 2),
            catch: (cause) => new ConfigError({ cause: cause }),
          });
          yield* fileSystem
            .writeFileString(configFilePath, `${json}\n`)
            .pipe(
              Effect.mapError((cause) => new ConfigError({ cause: cause })),
            );
        }),
    };
  }),
);
