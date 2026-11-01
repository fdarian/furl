import { Effect } from 'effect';
import type { HttpClient } from 'effect/http';

import {
  AllResolversFailed,
  type ConfigError,
  redactUrlUserInfo,
} from './errors.ts';
import {
  type MatchPattern,
  ResolveDecline,
  type Resolver,
} from './resolver.ts';

export type ResolutionResult = {
  markdown: string;
  source: string;
};

const matchPathPattern = (pattern: string, pathname: string): boolean => {
  const patternSegments = pattern
    .split('/')
    .filter((segment) => segment.length > 0);
  const pathSegments = pathname
    .split('/')
    .filter((segment) => segment.length > 0);

  if (patternSegments.length !== pathSegments.length) {
    return false;
  }

  return patternSegments.every(
    (patternSegment, index) =>
      patternSegment === '*' || patternSegment === pathSegments[index],
  );
};

export const matchesUrl = (match: MatchPattern | null, url: URL): boolean => {
  if (match === null) {
    return true;
  }

  if (match.hostname !== url.hostname) {
    return false;
  }

  if (match.path === undefined) {
    return true;
  }

  return matchPathPattern(match.path, url.pathname);
};

export const runResolvers = (
  url: URL,
  resolvers: readonly Resolver[],
): Effect.Effect<
  ResolutionResult,
  AllResolversFailed | ConfigError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const failures: { id: string; cause: unknown }[] = [];

    for (const resolver of resolvers) {
      if (!matchesUrl(resolver.match, url)) {
        continue;
      }

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
      url: redactUrlUserInfo(url.toString()),
      failures: failures,
    });
  });
