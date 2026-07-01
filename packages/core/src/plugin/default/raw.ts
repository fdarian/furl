import { Effect } from 'effect';

import { ResolverError } from '../../errors.ts';
import { matchAnySpecificity, type Resolver } from '../resolver.ts';
import {
  ResolveDecline,
  type ResolveOutcome,
  ResolveSuccess,
} from '../types.ts';

import {
  fetchRawBody,
  fileExtensionPattern,
  type HttpClientService,
} from './shared.ts';

export const rawResolver = (client: HttpClientService): Resolver => ({
  id: 'raw',
  isDefault: true,
  match: null,
  specificity: matchAnySpecificity,
  run: (url) =>
    Effect.gen(function* () {
      if (!fileExtensionPattern.test(url.pathname)) {
        return new ResolveDecline() satisfies ResolveOutcome;
      }

      const markdown = yield* fetchRawBody(client, url.toString()).pipe(
        Effect.mapError(
          (cause) => new ResolverError({ id: 'raw', cause: cause }),
        ),
      );

      return new ResolveSuccess({
        markdown: markdown,
      }) satisfies ResolveOutcome;
    }),
});
