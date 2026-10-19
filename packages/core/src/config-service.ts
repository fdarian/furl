import { Context, Effect, FileSystem, Layer, Option, Schema } from 'effect';

import { ConfigError } from './errors.ts';
import {
  insertProviderToken,
  pluginOrderToken,
  providerOrderToken,
} from './plugin/order.ts';
import {
  type ProviderName,
  providerNames,
  providerSchema,
} from './provider-name.ts';

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

const normalizeConfig = (config: FurlConfig): FurlConfig => {
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

export const removePluginConfig = (
  config: FurlConfig,
  pluginName: string,
): FurlConfig => {
  const order = config.order?.filter(
    (entry) => entry !== pluginOrderToken(pluginName),
  );
  const plugins =
    config.plugins === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(config.plugins).filter(
            (entry) => entry[0] !== pluginName,
          ),
        );

  return {
    ...config,
    ...(config.plugins === undefined ? {} : { plugins: plugins }),
    // An empty order is invalid; leaving it unset lets the default apply.
    order: order === undefined || order.length === 0 ? undefined : order,
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
  resolveProvider: Effect.Effect<Option.Option<ProviderName>, ConfigError>;
  /** The resolver precedence chain, defaulting to the keyless built-ins. */
  resolveOrder: Effect.Effect<readonly string[], ConfigError>;
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

      return {
        ...normalizeConfig(decoded),
        provider: decoded.provider,
      };
    });

    const resolveOrder = Effect.gen(function* () {
      const config = yield* read;
      return config.order ?? defaultOrder;
    });

    return {
      read: read,
      resolveProvider: Effect.gen(function* () {
        const order = yield* resolveOrder;
        for (const entry of order) {
          const provider = providerNames.find(
            (candidate) => providerOrderToken(candidate) === entry,
          );
          if (provider !== undefined) {
            return Option.some(provider);
          }
        }

        return Option.none();
      }),
      resolveOrder: resolveOrder,
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
            try: () => JSON.stringify(normalizeConfig(config), null, 2),
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
