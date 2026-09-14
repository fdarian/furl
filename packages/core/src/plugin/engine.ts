import { Effect } from 'effect';

import { AllResolversFailed, type ResolverError } from '../errors.ts';

import type { Resolver } from './resolver.ts';
import { ResolveDecline } from './types.ts';

export type ResolutionResult = {
  markdown: string;
  source: string;
};

const redactUserinfo = (url: URL): string => {
  if (url.username === '' && url.password === '') {
    return url.toString();
  }

  const redacted = new URL(url.toString());
  redacted.username = '';
  redacted.password = '';
  return redacted.toString();
};

export const runResolvers = (
  url: URL,
  resolvers: readonly Resolver[],
): Effect.Effect<ResolutionResult, AllResolversFailed | ResolverError> =>
  Effect.gen(function* () {
    const failures: { id: string; cause: unknown }[] = [];

    for (const resolver of resolvers) {
      const outcome = yield* resolver.run(url).pipe(
        Effect.catchTag('ResolverError', (error) => {
          failures.push({ id: resolver.id, cause: error.cause });
          return Effect.succeed(new ResolveDecline());
        }),
      );

      if (outcome._tag === 'success') {
        return { markdown: outcome.markdown, source: resolver.id };
      }

      if (outcome._tag === 'failure') {
        return yield* Effect.fail(outcome.error);
      }
    }

    return yield* new AllResolversFailed({
      url: redactUserinfo(url),
      failures: failures,
    });
  });
