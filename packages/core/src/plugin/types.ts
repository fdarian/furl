import { Data } from 'effect';

import type { ResolverError } from '../errors.ts';

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

/** A resolver produced markdown for the URL. */
export class ResolveSuccess extends Data.TaggedClass('success')<{
  markdown: string;
}> {}

/** A resolver declined to handle the URL. */
export class ResolveDecline extends Data.TaggedClass('decline') {}

/**
 * A resolver definitively claimed the URL (e.g. `raw`'s file-extension
 * match) and then failed to produce markdown for it. Unlike `ResolveDecline`,
 * this must abort the resolution chain instead of falling through to a
 * lower-priority resolver — falling through here would silently retry a URL
 * a resolver has already proven it owns, e.g. burning a paid provider's
 * quota scraping a URL that 404s by file extension alone.
 */
export class ResolveFailure extends Data.TaggedClass('failure')<{
  error: ResolverError;
}> {}

export type ResolveOutcome = ResolveSuccess | ResolveDecline | ResolveFailure;
