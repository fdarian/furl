import { Effect, Option } from 'effect';

import { ResolverError } from '../errors.ts';
import {
  ResolveDecline,
  type ResolveOutcome,
  type Resolver,
  ResolveSuccess,
} from '../resolver.ts';

import { tryDirectMarkdownFetch } from './shared.ts';

export const directResolver: Resolver = {
  id: 'direct',
  match: null,
  run: (url) =>
    tryDirectMarkdownFetch(url.toString()).pipe(
      Effect.map(
        (result): ResolveOutcome =>
          Option.isSome(result)
            ? new ResolveSuccess({ markdown: result.value })
            : new ResolveDecline(),
      ),
      Effect.mapError(
        (cause) => new ResolverError({ id: 'direct', cause: cause }),
      ),
    ),
};
