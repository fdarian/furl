import { Context, Effect, Layer } from 'effect';

import { PluginLoadError } from '../errors.ts';
import * as pluginAuthoring from './index.ts';

const registerVirtualPluginsModule = Effect.promise(async () => {
  await Bun.plugin({
    name: 'furl-cli-virtual-plugins-module',
    setup(build) {
      build.module('furl-cli/plugins', () => ({
        exports: {
          ...pluginAuthoring,
          default: pluginAuthoring.definePlugin,
        },
        loader: 'object' as const,
      }));
    },
  });
});

export class PluginLoader extends Context.Service<PluginLoader>()(
  'furl/plugin-loader',
  {
    make: Effect.gen(function* () {
      yield* registerVirtualPluginsModule;

      return {
        load: (entrypointPath: string) =>
          Effect.tryPromise({
            try: () => import(entrypointPath),
            catch: (cause) =>
              new PluginLoadError({ path: entrypointPath, cause: cause }),
          }).pipe(Effect.map((module) => module.default)),
      };
    }),
  },
) {
  static readonly layer = Layer.effect(PluginLoader, PluginLoader.make);
}
