import type { PluginManifest } from './types.ts';

/** Identity helper that gives plugin authors manifest type checking. */
export const definePlugin = (manifest: PluginManifest): PluginManifest =>
  manifest;
