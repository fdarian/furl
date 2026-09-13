import { Effect } from 'effect';

import { ResolverError } from '../../errors.ts';
import { fetchWithFirecrawl } from '../../providers/firecrawl.ts';
import type { SecretsService } from '../../secrets-service.ts';
import { matchAnySpecificity, type Resolver } from '../resolver.ts';
import { type ResolveOutcome, ResolveSuccess } from '../types.ts';

import type { HttpClientService } from './shared.ts';

export const firecrawlResolver = (
  client: HttpClientService,
  secrets: SecretsService,
): Resolver => ({
  id: 'firecrawl',
  source: 'provider:firecrawl',
  isDefault: true,
  match: null,
  specificity: matchAnySpecificity,
  run: (url) =>
    fetchWithFirecrawl(client, secrets, url.toString()).pipe(
      Effect.map(
        (markdown): ResolveOutcome =>
          new ResolveSuccess({ markdown: markdown }),
      ),
      Effect.mapError(
        (cause) => new ResolverError({ id: 'firecrawl', cause: cause }),
      ),
    ),
});
