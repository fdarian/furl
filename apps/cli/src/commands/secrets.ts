import { Secrets } from '@furl/core';
import { Console, Effect, Redacted } from 'effect';
import { Argument, Command, Prompt } from 'effect/unstable/cli';

const secretNameArgument = Argument.string('name').pipe(
  Argument.withDescription(
    'Secret name, e.g. a plugin config field reference like "secret:<name>"',
  ),
);

export const secretsSetCommand = Command.make(
  'set',
  { name: secretNameArgument },
  (commandConfig) =>
    Effect.gen(function* () {
      const secrets = yield* Secrets;
      const value = yield* Prompt.password({
        message: `Enter value for "${commandConfig.name}":`,
      });
      yield* secrets.set(commandConfig.name, Redacted.value(value));
      yield* Console.log(`Saved secret "${commandConfig.name}".`);
    }),
).pipe(Command.withDescription('Store a secret in the OS keychain'));

export const secretsCommand = Command.make('secrets', {}, () =>
  Effect.gen(function* () {
    yield* Console.log('Usage: furl secrets set <name>');
  }),
).pipe(
  Command.withSubcommands([secretsSetCommand]),
  Command.withDescription('Manage furl secrets'),
);
