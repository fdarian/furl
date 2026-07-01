import type { PluginManifest } from './types.ts';

/**
 * Identity function plugin authors wrap their manifest in. It returns the
 * manifest unchanged at runtime; its only purpose is to give the author type
 * inference on `resolve`'s `ctx` and the rest of the manifest shape.
 */
export const definePlugin = (manifest: PluginManifest): PluginManifest =>
  manifest;
