import { Console, Effect } from 'effect';

import { AllResolversFailed, describeCause } from '../errors.ts';

import type { Resolver } from './resolver.ts';
import { ResolveDecline } from './types.ts';

export type ResolutionResult = {
  markdown: string;
  source: string;
};

/**
 * Runs `resolvers` in order: a decline moves on silently; a `ResolverError`
 * is printed to stderr and the chain continues; a success returns
 * immediately. If every resolver declines or errors, fails with
 * `AllResolversFailed`.
 */
export const runResolvers = (
  url: URL,
  resolvers: readonly Resolver[],
): Effect.Effect<ResolutionResult, AllResolversFailed> =>
  Effect.gen(function* () {
    for (const resolver of resolvers) {
      const outcome = yield* resolver
        .run(url)
        .pipe(
          Effect.catchTag('ResolverError', (error) =>
            Console.error(
              `↳ ${resolver.id} failed: ${describeCause(error.cause)}, continuing`,
            ).pipe(Effect.as(new ResolveDecline())),
          ),
        );

      if (outcome._tag === 'success') {
        return { markdown: outcome.markdown, source: resolver.id };
      }
    }

    return yield* new AllResolversFailed({ url: url.toString() });
  });
