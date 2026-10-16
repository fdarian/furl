import { Command } from 'effect/unstable/cli';
import { runConfigurePluginMenu } from './configure';
import { pluginsInstallCommand } from './install';
import { pluginsListCommand } from './list';
import { pluginsUninstallCommand } from './uninstall';

export const pluginsCommand = Command.make(
  'plugins',
  {},
  () => runConfigurePluginMenu,
).pipe(
  Command.withSubcommands([
    pluginsInstallCommand,
    pluginsListCommand,
    pluginsUninstallCommand,
  ]),
  Command.withDescription('Manage furl plugins'),
);
