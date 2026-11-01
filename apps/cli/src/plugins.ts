/** Public authoring surface for `furl-cli/plugins`. Deliberately imports nothing. */

/**
 * Declarative host/path matcher used to route plugins for a URL. A standalone
 * copy of `furl-core`'s `MatchPattern` so plugin authors need no other package.
 */
export type MatchPattern = {
  hostname: string;
  path?: string;
};

/** A single field a plugin wants rendered in the `furl plugins` config form. */
export type ConfigField = {
  key: string;
  type: 'string' | 'secret' | 'boolean' | 'number' | 'enum';
  label?: string;
  description?: string;
  required?: boolean;
  options?: string[];
};

/** What a plugin's `resolve` returns on success, or `null` to decline. */
export type PluginResolveResult = { markdown: string } | null;

/** Context passed to a plugin's `resolve` for a single URL. */
export type ResolveContext = {
  url: URL;
  config: Record<string, unknown>;
  decline: () => null;
};

/** The manifest a plugin author exports via `definePlugin`. */
export type PluginManifest = {
  name: string;
  match: MatchPattern;
  config?: ConfigField[];
  resolve: (
    ctx: ResolveContext,
  ) => PluginResolveResult | Promise<PluginResolveResult>;
};

/** Identity helper that gives plugin authors manifest type checking. */
export const definePlugin = (manifest: PluginManifest): PluginManifest =>
  manifest;
