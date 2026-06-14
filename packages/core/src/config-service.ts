import { Context, Effect, FileSystem, Layer, Option, Schema } from 'effect';

import { ConfigError } from './errors.ts';
import type { ProviderName } from './provider-name.ts';
import { providerSchema } from './provider-name.ts';

const furlConfigSchema = Schema.Struct({
  provider: Schema.optional(providerSchema),
});

export type FurlConfig = {
  provider?: ProviderName | undefined;
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
