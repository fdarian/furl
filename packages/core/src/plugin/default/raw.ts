import { Effect } from 'effect';

import { ResolverError } from '../../errors.ts';
import { matchAnySpecificity, type Resolver } from '../resolver.ts';
import {
  ResolveDecline,
  ResolveFailure,
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
      if (fileExtensionPattern.exec(url.pathname) === null) {
        return new ResolveDecline() satisfies ResolveOutcome;
      }

      return yield* fetchRawBody(client, url.toString()).pipe(
        Effect.map(
          (markdown): ResolveOutcome =>
            new ResolveSuccess({ markdown: markdown }),
        ),
        Effect.catchTag('FetchError', (cause) =>
          Effect.succeed<ResolveOutcome>(
            new ResolveFailure({
              error: new ResolverError({ id: 'raw', cause: cause }),
            }),
          ),
        ),
      );
    }),
});
