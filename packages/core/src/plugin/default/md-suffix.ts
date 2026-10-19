import { Effect, Option } from 'effect';

import { ResolverError } from '../../errors.ts';

import type { Resolver } from '../resolver.ts';
import {
  ResolveDecline,
  type ResolveOutcome,
  ResolveSuccess,
} from '../types.ts';

import {
  appendMarkdownSuffix,
  type HttpClientService,
  tryDirectMarkdownFetch,
} from './shared.ts';

export const mdSuffixResolver = (client: HttpClientService): Resolver => ({
  id: 'md-suffix',
  isDefault: true,
  match: null,
  run: (url) =>
    tryDirectMarkdownFetch(client, appendMarkdownSuffix(url.toString())).pipe(
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
});
