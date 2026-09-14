import { Data } from 'effect';

import type { ResolverError } from '../errors.ts';

export type MatchPattern = {
  hostname: string;
  path?: string;
};

export class ResolveSuccess extends Data.TaggedClass('success')<{
  markdown: string;
}> {}

export class ResolveDecline extends Data.TaggedClass('decline') {}

export class ResolveFailure extends Data.TaggedClass('failure')<{
  error: ResolverError;
}> {}

export type ResolveOutcome = ResolveSuccess | ResolveDecline | ResolveFailure;
