import { Context, Effect, Layer } from 'effect';

import { KeychainError } from './errors.ts';

const serviceName = 'com.fdarian.furl';

export interface SecretsService {
  get: (name: string) => Effect.Effect<string | null, KeychainError>;
  set: (name: string, value: string) => Effect.Effect<void, KeychainError>;
  delete: (name: string) => Effect.Effect<boolean, KeychainError>;
}

export class Secrets extends Context.Service<Secrets, SecretsService>()(
  'furl/secrets',
) {}

export const SecretsLive = Layer.succeed(Secrets, {
  get: (name: string) =>
    Effect.tryPromise({
      try: () => Bun.secrets.get({ service: serviceName, name: name }),
      catch: (cause) => new KeychainError({ cause: cause }),
    }),
  set: (name: string, value: string) =>
    Effect.tryPromise({
      try: () =>
        Bun.secrets.set({ service: serviceName, name: name, value: value }),
      catch: (cause) => new KeychainError({ cause: cause }),
    }),
  delete: (name: string) =>
    Effect.tryPromise({
      try: () => Bun.secrets.delete({ service: serviceName, name: name }),
      catch: (cause) => new KeychainError({ cause: cause }),
    }),
});
