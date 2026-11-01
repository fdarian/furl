import { Effect } from 'effect';
import { Command } from 'effect/cli';
import { secretsSetCommand } from './set';

export const secretsCommand = Command.make(
  'secrets',
  {},
  () => Effect.void,
).pipe(
  Command.withSubcommands([secretsSetCommand]),
  Command.withDescription('Manage furl secrets'),
);
