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

/**
 * Matching by file extension is a definitive claim on the URL — unlike the
 * opportunistic built-ins (`direct`, `jina`, ...), there's no lower-priority
 * resolver a 404 on a `.pdf`/`.md`/etc URL should fall through to. A fetch
 * failure here aborts the chain (`ResolveFailure`) instead of declining, so
 * it can't burn a paid provider's quota scraping a dead URL.
 */
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
