import { Console, Effect, Redacted } from 'effect';
import { Argument, Command, Prompt } from 'effect/cli';
import { setGenericSecret } from '../../plugin/resolve-config';
import { Secrets } from '../../secrets-service';

const secretNameArgument = Argument.String('name').pipe(
  Argument.withDescription(
    'Secret name, as referenced from plugin config via "secret:<name>"',
  ),
);

export const secretsSetCommand = Command.make(
  'set',
  { name: secretNameArgument },
  (commandConfig) =>
    Effect.gen(function* () {
      const secrets = yield* Secrets;
      const value = yield* Prompt.Password({
        message: `Enter value for "${commandConfig.name}":`,
      });
      yield* setGenericSecret(
        secrets,
        commandConfig.name,
        Redacted.value(value),
      );
      yield* Console.log(`Saved secret "${commandConfig.name}".`);
    }),
).pipe(Command.withDescription('Store a secret in the OS keychain'));
