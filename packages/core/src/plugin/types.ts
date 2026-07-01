/** Declarative host/path matcher used to rank and route plugins for a URL. */
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

/**
 * Internal outcome shape used at the resolver adapter boundary (see
 * `plugin/resolver.ts`, added in a later phase) to normalize plugin and
 * built-in strategy results before the engine's try-chain runs. Errors are
 * carried on the Effect failure channel, not in this type.
 */
export type ResolveOutcome =
  | { _tag: 'success'; markdown: string }
  | { _tag: 'decline' };
