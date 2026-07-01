import { Context, Effect, FileSystem, Layer, Option, Schema } from 'effect';

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

const defaultOrder: readonly string[] = ['*', 'default:*'];

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

const getConfigFilePath = getHomeDirectory.pipe(
  Effect.map(
    (homeDirectory) =>
      `${homeDirectory}/${configDirectoryName}/${configFileName}`,
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
  /** The resolver precedence chain, defaulting to `['*', 'default:*']`. */
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

      return yield* decodeConfig(parsedConfig).pipe(
        Effect.mapError((cause) => new ConfigError({ cause: cause })),
      );
    });

    return {
      read: read,
      resolveProvider: (providerOverride: Option.Option<ProviderName>) =>
        Effect.gen(function* () {
          if (Option.isSome(providerOverride)) {
            return providerOverride.value;
          }

          const config = yield* read;

          if (config.provider !== undefined) {
            return config.provider;
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
