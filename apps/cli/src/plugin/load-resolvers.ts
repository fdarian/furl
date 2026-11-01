import type { Context } from 'effect';
import { Effect } from 'effect';
import type { ConfigError, Resolver } from 'furl-lib';

import type { FurlConfigServiceShape } from '../config-service.ts';
import type { PluginLoadError } from '../errors.ts';
import type { SecretsService } from '../secrets-service.ts';
import { createDefaultResolvers } from './default-resolvers.ts';
import type { PluginDiscovery } from './discovery.ts';
import {
  buildResolverList,
  parseOrderTokens,
  pluginNamesInOrder,
} from './order.ts';

/** Resolves the configured order (or `orderOverride`) into resolvers, discovering plugins only when the order names one. */
export const loadResolvers = (
  config: FurlConfigServiceShape,
  secrets: SecretsService,
  discovery: Context.Service.Shape<typeof PluginDiscovery>,
  orderOverride: readonly string[] | undefined,
): Effect.Effect<Resolver[], ConfigError | PluginLoadError> =>
  Effect.gen(function* () {
    const order = orderOverride ?? (yield* config.resolveOrder);
    const parsedTokens = yield* parseOrderTokens(order);
    const pluginNames = pluginNamesInOrder(parsedTokens);
    const discoveredPlugins =
      pluginNames.length > 0 ? yield* discovery.discover(pluginNames) : [];

    return yield* buildResolverList(
      config,
      secrets,
      createDefaultResolvers(secrets),
      discoveredPlugins,
      parsedTokens,
    );
  });
