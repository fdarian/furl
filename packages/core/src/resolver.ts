import { Data, type Effect } from 'effect';
import type { HttpClient } from 'effect/http';

import type { ConfigError, ResolverError } from './errors.ts';

/** Declarative host/path matcher; a resolver only runs for URLs it matches. */
export type MatchPattern = {
  hostname: string;
  path?: string;
};

/** A resolver produced markdown for the URL. */
export class ResolveSuccess extends Data.TaggedClass('success')<{
  markdown: string;
}> {}

/** A resolver declined to handle the URL. */
export class ResolveDecline extends Data.TaggedClass('decline') {}

export type ResolveOutcome = ResolveSuccess | ResolveDecline;

export type Resolver = {
  /** Reported as `FetchResult.source` and in `AllResolversFailed` failures. */
  id: string;
  match: MatchPattern | null;
  /** A `ConfigError` aborts the chain; a `ResolverError` is recorded and the chain continues. */
  run: (
    url: URL,
  ) => Effect.Effect<
    ResolveOutcome,
    ResolverError | ConfigError,
    HttpClient.HttpClient
  >;
};
