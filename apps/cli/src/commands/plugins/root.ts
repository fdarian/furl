import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';
import { pluginsInstallCommand } from './install';
import { pluginsListCommand } from './list';
import { pluginsUninstallCommand } from './uninstall';

export const pluginsCommand = Command.make(
  'plugins',
  {},
  () => Effect.void,
).pipe(
  Command.withSubcommands([
    pluginsInstallCommand,
    pluginsListCommand,
    pluginsUninstallCommand,
  ]),
  Command.withDescription('Manage furl plugins'),
);
