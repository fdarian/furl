#!/usr/bin/env bun

import { BunRuntime, BunServices } from '@effect/platform-bun';
import {
  FurlConfigServiceLive,
  FurlLive,
  PluginDiscovery,
  PluginLoader,
  PluginManager,
  SecretsLive,
} from '@furl/core';
import { Effect, Layer } from 'effect';
import { Command } from 'effect/unstable/cli';
import { FetchHttpClient } from 'effect/unstable/http';
import packageJson from '../package.json';
import { rootCommand } from './commands/root';

const configLayer = FurlConfigServiceLive.pipe(
  Layer.provide(BunServices.layer),
);

const pluginDiscoveryLayer = PluginDiscovery.layer.pipe(
  Layer.provide(Layer.mergeAll(BunServices.layer, PluginLoader.layer)),
);

const pluginManagerLayer = PluginManager.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      BunServices.layer,
      PluginLoader.layer,
      configLayer,
      SecretsLive,
    ),
  ),
);

const furlLayer = FurlLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      BunServices.layer,
      FetchHttpClient.layer,
      SecretsLive,
      configLayer,
    ),
  ),
);

const appLayer = Layer.mergeAll(
  BunServices.layer,
  SecretsLive,
  configLayer,
  PluginLoader.layer,
  pluginDiscoveryLayer,
  pluginManagerLayer,
  furlLayer,
);

const program = Command.run(rootCommand, {
  version: packageJson.version,
}).pipe(Effect.provide(appLayer));

BunRuntime.runMain(program);
