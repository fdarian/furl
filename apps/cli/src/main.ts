#!/usr/bin/env bun

import { BunRuntime, BunServices } from '@effect/platform-bun';
import {
  FurlConfigServiceLive,
  FurlLive,
  PluginDiscoveryLive,
  PluginLoaderLive,
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

/**
 * Registers the `furl-cli/plugins` Bun virtual module (see `PluginLoaderLive`
 * in `@furl/core`) exactly once. This same layer instance is referenced both
 * here and inside `FurlLive`'s own internal dependency chain; Effect's layer
 * memoization builds a shared Layer instance only once per `Effect.provide`
 * graph, so the virtual module is guaranteed registered before the first
 * plugin entrypoint is dynamically imported by either path.
 */
const pluginLoaderLayer = PluginLoaderLive;

const pluginDiscoveryLayer = PluginDiscoveryLive.pipe(
  Layer.provide(Layer.mergeAll(BunServices.layer, pluginLoaderLayer)),
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
  pluginLoaderLayer,
  pluginDiscoveryLayer,
  furlLayer,
);

const program = Command.run(rootCommand, {
  version: packageJson.version,
}).pipe(Effect.provide(appLayer));

BunRuntime.runMain(program);
