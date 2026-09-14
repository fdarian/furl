import { Effect } from 'effect';

import { ResolverError } from '../../errors.ts';
import { fetchWithExa } from '../../providers/exa.ts';
import type { SecretsService } from '../../secrets-service.ts';
import { matchAnySpecificity, type Resolver } from '../resolver.ts';
import { type ResolveOutcome, ResolveSuccess } from '../types.ts';

import type { HttpClientService } from './shared.ts';

export const exaResolver = (
  client: HttpClientService,
  secrets: SecretsService,
): Resolver => ({
  id: 'exa',
  isDefault: true,
  match: null,
  specificity: matchAnySpecificity,
  run: (url) =>
    fetchWithExa(client, secrets, url.toString()).pipe(
      Effect.map(
        (markdown): ResolveOutcome =>
          new ResolveSuccess({ markdown: markdown }),
      ),
      Effect.mapError(
        (cause) => new ResolverError({ id: 'exa', cause: cause }),
      ),
    ),
});
