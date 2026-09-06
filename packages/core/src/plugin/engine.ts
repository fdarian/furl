import { Effect } from 'effect';

import { AllResolversFailed, type ResolverError } from '../errors.ts';

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
 * (a resolver with no definitive claim on the URL) is recorded and treated
 * as a decline; a `ResolveFailure` (a resolver that definitively claimed the
 * URL and then failed, e.g. `raw`) aborts the chain immediately, surfacing
 * its own cause instead of falling through to a lower-priority resolver; a
 * success returns immediately. If every resolver declines or non-terminally
 * errors, fails with `AllResolversFailed`, carrying every recorded cause so
 * a caller can distinguish, say, a missing API key from a network failure
 * instead of only seeing "no resolver could produce markdown".
 */
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
