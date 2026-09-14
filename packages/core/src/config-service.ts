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

const pluginConfigValueSchema = Schema.Record(Schema.String, Schema.Unknown);

const furlConfigSchema = Schema.Struct({
  provider: Schema.optional(providerSchema),
  order: Schema.optional(Schema.Array(Schema.String)),
  plugins: Schema.optional(
    Schema.Record(Schema.String, pluginConfigValueSchema),
  ),
});

export type PluginConfigValue = Record<string, unknown>;

export type FurlConfig = {
  provider?: ProviderName | undefined;
  order?: readonly string[] | undefined;
  plugins?: Readonly<Record<string, PluginConfigValue>> | undefined;
};

const defaultOrder: readonly string[] = ['default:*'];

const defaultOrderTokenPrefix = 'default:';

const providerOrderToken = (provider: ProviderName): string =>
  `${defaultOrderTokenPrefix}${provider}`;

const providerNames: readonly ProviderName[] = ['jina', 'exa', 'firecrawl'];

const providerOrderTokens: ReadonlySet<string> = new Set(
  providerNames.map(providerOrderToken),
);

const freeProbeOrderTokens: readonly string[] = [
  'default:*',
  'default:raw',
  'default:direct',
  'default:md-suffix',
];

/** Inserts a provider token after free probes and before other provider tokens. */
export const insertProviderToken = (
  order: readonly string[],
  provider: ProviderName,
): string[] => {
  const token = providerOrderToken(provider);
  const withoutToken = order.filter((entry) => entry !== token);

  const otherProviderIndex = withoutToken.findIndex((entry) =>
    providerOrderTokens.has(entry),
  );

  if (otherProviderIndex !== -1) {
    return [
      ...withoutToken.slice(0, otherProviderIndex),
      token,
      ...withoutToken.slice(otherProviderIndex),
    ];
  }

  const lastFreeProbeIndex = withoutToken.reduce(
    (lastIndex, entry, index) =>
      freeProbeOrderTokens.includes(entry) ? index : lastIndex,
    -1,
  );
  const insertAt =
    lastFreeProbeIndex === -1 ? withoutToken.length : lastFreeProbeIndex + 1;

  return [
    ...withoutToken.slice(0, insertAt),
    token,
    ...withoutToken.slice(insertAt),
  ];
};

const migrateLegacyProvider = (config: FurlConfig): FurlConfig => {
  if (config.provider === undefined) {
    return config;
  }

  const order =
    config.order ?? insertProviderToken(defaultOrder, config.provider);

  return {
    order: order,
    ...(config.plugins === undefined ? {} : { plugins: config.plugins }),
  };
};

const normalizeConfigForWrite = (config: FurlConfig): FurlConfig => {
  const order =
    config.order ??
    (config.provider === undefined
      ? defaultOrder
      : insertProviderToken(defaultOrder, config.provider));

  return {
    order: order,
    ...(config.plugins === undefined ? {} : { plugins: config.plugins }),
  };
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

/** Absolute path to `~/.config/furl`, the base directory for config and plugins. */
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
  /** The resolver precedence chain, defaulting to the keyless built-ins. */
  resolveOrder: Effect.Effect<readonly string[], ConfigError>;
  pluginArgs: (
    id: string,
  ) => Effect.Effect<PluginConfigValue | undefined, ConfigError>;
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

      if (decoded.order === undefined) {
        yield* Console.error(
          `↳ config.json's "provider" field ("${decoded.provider}") is deprecated; using it as "${providerOrderToken(decoded.provider)}" in "order" for this run. Run \`furl providers\` to persist the migration and drop the field.`,
        );
      } else {
        yield* Console.error(
          `↳ config.json contains both "order" and the deprecated "provider" field ("${decoded.provider}"); "order" wins. Run \`furl providers\` to drop the field.`,
        );
      }

      return migrateLegacyProvider(decoded);
    });

    const resolveOrder = Effect.gen(function* () {
      const config = yield* read;
      return config.order ?? defaultOrder;
    });

    return {
      read: read,
      resolveProvider: (providerOverride: Option.Option<ProviderName>) =>
        Effect.gen(function* () {
          if (Option.isSome(providerOverride)) {
            return providerOverride.value;
          }

          const order = yield* resolveOrder;
          for (const entry of order) {
            const provider = providerNames.find(
              (candidate) => providerOrderToken(candidate) === entry,
            );
            if (provider !== undefined) {
              return provider;
            }
          }

          return 'jina';
        }),
      resolveOrder: resolveOrder,
      pluginArgs: (id: string) =>
        Effect.gen(function* () {
          const config = yield* read;
          return config.plugins?.[id];
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
            try: () => JSON.stringify(normalizeConfigForWrite(config), null, 2),
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
