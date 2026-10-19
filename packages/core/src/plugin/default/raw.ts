import { Effect, Option } from 'effect';

import { ResolverError } from '../../errors.ts';
import type { Resolver } from '../resolver.ts';
import {
  ResolveDecline,
  type ResolveOutcome,
  ResolveSuccess,
} from '../types.ts';
import {
  fileExtensionPattern,
  type HttpClientService,
  tryRawFetch,
} from './shared.ts';

export const rawResolver = (client: HttpClientService): Resolver => ({
  id: 'raw',
  isDefault: true,
  match: null,
  run: (url) =>
    Effect.gen(function* () {
      if (fileExtensionPattern.exec(url.pathname) === null) {
        return new ResolveDecline() satisfies ResolveOutcome;
      }

      const body = yield* tryRawFetch(client, url.toString()).pipe(
        Effect.mapError(
          (cause) => new ResolverError({ id: 'raw', cause: cause }),
        ),
      );

      return Option.isSome(body)
        ? (new ResolveSuccess({
            markdown: body.value,
          }) satisfies ResolveOutcome)
        : (new ResolveDecline() satisfies ResolveOutcome);
    }),
});
