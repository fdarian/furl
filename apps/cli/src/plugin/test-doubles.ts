import { Effect } from 'effect';
import { HttpClient } from 'effect/http';

export const makeSecretsStub = (
  initial: Readonly<Record<string, string>> = {},
) => {
  const store = new Map(Object.entries(initial));

  return {
    get: (name: string) =>
      Effect.sync(() => {
        const value = store.get(name);
        return value === undefined ? null : value;
      }),
    set: (name: string, value: string) =>
      Effect.sync(() => {
        store.set(name, value);
      }),
    delete: (name: string) => Effect.sync(() => store.delete(name)),
  };
};

/** Runs a resolver's effect with a client that fails the test if it is used. */
export const withUnusedHttpClient = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
): Effect.Effect<A, E> =>
  effect.pipe(
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die('HttpClient must not be used')),
    ),
  );
