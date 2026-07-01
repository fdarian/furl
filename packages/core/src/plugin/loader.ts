import { Context, Effect, Layer } from 'effect';

import { PluginLoadError } from '../errors.ts';

/**
 * Registers the `furl-cli/plugins` virtual module via `Bun.plugin`. Cloned
 * plugin folders import `definePlugin` from that specifier with no
 * `node_modules` of their own — Bun intercepts it at runtime instead of
 * resolving it on disk. Must be awaited once, before any plugin entrypoint
 * is dynamically imported (see `scratchpad/bun-spike/host.ts`).
 */
const registerVirtualPluginsModule = Effect.promise(async () => {
  await Bun.plugin({
    name: 'furl-cli-virtual-plugins-module',
    setup(build) {
      build.module('furl-cli/plugins', () => {
        const definePlugin = (manifest: unknown) => manifest;
        return {
          exports: { definePlugin: definePlugin, default: definePlugin },
          loader: 'object' as const,
        };
      });
    },
  });
});

export type PluginLoaderShape = {
  /** Dynamically imports a plugin entrypoint by absolute path and returns its default export (the manifest). */
  load: (entrypointPath: string) => Effect.Effect<unknown, PluginLoadError>;
};

export class PluginLoader extends Context.Service<
  PluginLoader,
  PluginLoaderShape
>()('furl/plugin-loader') {}

export const PluginLoaderLive = Layer.effect(
  PluginLoader,
  Effect.gen(function* () {
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
);
