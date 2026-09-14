import type { Effect } from 'effect';

import type { ResolverError } from '../errors.ts';
import type { MatchPattern, ResolveOutcome } from './types.ts';

export type Resolver = {
  id: string;
  isDefault: boolean;
  match: MatchPattern | null;
  specificity: number;
  run: (url: URL) => Effect.Effect<ResolveOutcome, ResolverError>;
};

export const matchAnySpecificity = -1;

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
