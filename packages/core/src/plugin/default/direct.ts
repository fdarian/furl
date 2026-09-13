import { Effect, Option } from 'effect';

import { matchAnySpecificity, type Resolver } from '../resolver.ts';
import {
  ResolveDecline,
  type ResolveOutcome,
  ResolveSuccess,
} from '../types.ts';

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
            ? new ResolveSuccess({ markdown: result.value })
            : new ResolveDecline(),
      ),
    ),
});
