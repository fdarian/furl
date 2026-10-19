import type { Effect } from 'effect';

import type { ConfigError, ResolverError } from '../errors.ts';
import type { MatchPattern, ResolveOutcome } from './types.ts';

export type Resolver = {
  id: string;
  isDefault: boolean;
  match: MatchPattern | null;
  /** A `ConfigError` aborts the chain; a `ResolverError` is recorded and the chain continues. */
  run: (url: URL) => Effect.Effect<ResolveOutcome, ResolverError | ConfigError>;
};

/** The order token that selects this resolver, e.g. `default:jina` or `plugin:x`. */
export const resolverIdentity = (resolver: Resolver): string =>
  `${resolver.isDefault ? 'default' : 'plugin'}:${resolver.id}`;
