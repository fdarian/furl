import { Effect, Option } from 'effect';

import { matchAnySpecificity, type Resolver } from '../resolver.ts';
import type { ResolveOutcome } from '../types.ts';

import { type HttpClientService, tryDirectMarkdownFetch } from './shared.ts';

export const directResolver = (client: HttpClientService): Resolver => ({
  id: 'direct',
  isDefault: true,
  match: null,
  specificity: matchAnySpecificity,
  run: (url) =>
    tryDirectMarkdownFetch(client, url.toString()).pipe(
      Effect.map(
        (result): ResolveOutcome =>
          Option.isSome(result)
            ? { _tag: 'success', markdown: result.value }
            : { _tag: 'decline' },
      ),
    ),
});
