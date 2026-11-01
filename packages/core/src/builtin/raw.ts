import { Effect, Option } from 'effect';

import { ResolverError } from '../errors.ts';
import {
  ResolveDecline,
  type ResolveOutcome,
  type Resolver,
  ResolveSuccess,
} from '../resolver.ts';

import { fileExtensionPattern, tryRawFetch } from './shared.ts';

export const rawResolver: Resolver = {
  id: 'raw',
  match: null,
  run: (url) =>
    Effect.gen(function* () {
      if (fileExtensionPattern.exec(url.pathname) === null) {
        return new ResolveDecline() satisfies ResolveOutcome;
      }

      const body = yield* tryRawFetch(url.toString()).pipe(
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
};
