import { Effect } from 'effect';

import { AllResolversFailed } from '../errors.ts';

import type { Resolver } from './resolver.ts';
import { ResolveDecline } from './types.ts';

export type ResolutionResult = {
  markdown: string;
  source: string;
};

/** Strips `user:pass@` userinfo from a URL before it can land in `AllResolversFailed` or its message. */
const redactUserinfo = (url: URL): string => {
  if (url.username === '' && url.password === '') {
    return url.toString();
  }

  const redacted = new URL(url.toString());
  redacted.username = '';
  redacted.password = '';
  return redacted.toString();
};

/**
 * Runs `resolvers` in order: a decline moves on silently; a `ResolverError`
 * is recorded (not printed) and treated as a decline; a success returns
 * immediately. If every resolver declines or errors, fails with
 * `AllResolversFailed`, carrying every resolver's recorded cause so a
 * caller can distinguish, say, a missing API key from a network failure
 * instead of only seeing "no resolver could produce markdown".
 */
export const runResolvers = (
  url: URL,
  resolvers: readonly Resolver[],
): Effect.Effect<ResolutionResult, AllResolversFailed> =>
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
    }

    return yield* new AllResolversFailed({
      url: redactUserinfo(url),
      failures: failures,
    });
  });
