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

/** A resolver produced markdown for the URL. */
export class ResolveSuccess extends Data.TaggedClass('success')<{
  markdown: string;
}> {}

/** A resolver declined to handle the URL. */
export class ResolveDecline extends Data.TaggedClass('decline') {}

/** A resolver definitively claimed the URL and then failed. */
export class ResolveFailure extends Data.TaggedClass('failure')<{
  error: ResolverError;
}> {}

export type ResolveOutcome = ResolveSuccess | ResolveDecline | ResolveFailure;
