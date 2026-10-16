import { Effect } from 'effect';

import {
  AllResolversFailed,
  type ConfigError,
  redactUrlUserInfo,
} from '../errors.ts';

import { type Resolver, resolverIdentity } from './resolver.ts';
import { ResolveDecline } from './types.ts';

export type ResolutionResult = {
  markdown: string;
  source: string;
};

export const runResolvers = (
  url: URL,
  resolvers: readonly Resolver[],
): Effect.Effect<ResolutionResult, AllResolversFailed | ConfigError> =>
  Effect.gen(function* () {
    const failures: { id: string; cause: unknown }[] = [];

    for (const resolver of resolvers) {
      const identity = resolverIdentity(resolver);
      const outcome = yield* resolver.run(url).pipe(
        Effect.catchTag('ResolverError', (error) => {
          failures.push({ id: identity, cause: error.cause });
          return Effect.succeed(new ResolveDecline());
        }),
      );

      if (outcome._tag === 'success') {
        return { markdown: outcome.markdown, source: identity };
      }
    }

    return yield* new AllResolversFailed({
      url: redactUrlUserInfo(url.toString()),
      failures: failures,
    });
  });
