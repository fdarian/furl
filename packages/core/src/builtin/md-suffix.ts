import { Effect, Option } from 'effect';

import { ResolverError } from '../errors.ts';
import {
  ResolveDecline,
  type ResolveOutcome,
  type Resolver,
  ResolveSuccess,
} from '../resolver.ts';

import { appendMarkdownSuffix, tryDirectMarkdownFetch } from './shared.ts';

export const mdSuffixResolver: Resolver = {
  id: 'md-suffix',
  match: null,
  run: (url) =>
    tryDirectMarkdownFetch(appendMarkdownSuffix(url.toString())).pipe(
      Effect.map(
        (result): ResolveOutcome =>
          Option.isSome(result)
            ? new ResolveSuccess({ markdown: result.value })
            : new ResolveDecline(),
      ),
      Effect.mapError(
        (cause) => new ResolverError({ id: 'md-suffix', cause: cause }),
      ),
    ),
};
