import type { Effect } from 'effect';

import type { ResolverError } from '../errors.ts';
import type { MatchPattern, ResolveOutcome } from './types.ts';

/**
 * A single entry in the resolution chain — either a built-in `default:`
 * strategy or a discovered plugin, normalized to the same shape so the
 * engine's try-chain can run them uniformly. Decline/success travel on the
 * success channel (`ResolveOutcome`); genuine failures travel on the Effect
 * error channel as `ResolverError`.
 */
export type Resolver = {
  id: string;
  isDefault: boolean;
  match: MatchPattern | null;
  specificity: number;
  run: (url: URL) => Effect.Effect<ResolveOutcome, ResolverError>;
};

/** Specificity assigned to a match-anything resolver (`match: null`); always sorts last. */
export const matchAnySpecificity = -1;

/**
 * Ranks a matcher's precision so a narrower host/path pattern outranks a
 * broader one when expanding `*`/`default:*` order tokens: an exact hostname
 * beats no matcher, and more literal (non-wildcard) path segments beat fewer.
 */
export const computeSpecificity = (match: MatchPattern | null): number => {
  if (match === null) {
    return matchAnySpecificity;
  }

  if (match.path === undefined) {
    return 0;
  }

  const literalSegmentCount = match.path
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '*').length;

  return literalSegmentCount + 1;
};
