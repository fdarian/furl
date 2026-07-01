/**
 * Public authoring surface for `furl-cli/plugins`. Canonical types and the
 * `definePlugin` identity function live in `@furl/core`'s plugin module;
 * this file just re-exports them under the package name plugin authors
 * install. At runtime, when a plugin is loaded by the furl CLI host, this
 * exact specifier is intercepted by a Bun virtual module instead of
 * resolving here (see the plugin loader, added in a later phase).
 */

export type {
  ConfigField,
  MatchPattern,
  PluginManifest,
  PluginResolveResult,
  ResolveContext,
} from '@furl/core/plugins';
export { definePlugin } from '@furl/core/plugins';
