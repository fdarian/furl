import {
  FurlConfigService,
  getPluginsDirectoryPath,
  PluginDiscovery,
  pluginOrderToken,
} from '@furl/core';
import { Console, Effect } from 'effect';
import { Command } from 'effect/unstable/cli';

export const formatPluginLine = (
  name: string,
  folder: string,
  order: readonly string[],
): string => {
  const enabled = order.includes(pluginOrderToken(name));
  return `${name}  (${enabled ? 'enabled' : 'disabled'}) - ${folder}`;
};

export const pluginsListCommand = Command.make('list', {}, () =>
  Effect.gen(function* () {
    const discovery = yield* PluginDiscovery;
    const configService = yield* FurlConfigService;

    const names = yield* discovery.installedNames;

    if (names.length === 0) {
      yield* Console.log(
        'No plugins installed. Run `furl plugins install <git-url>` to add one.',
      );
      return;
    }

    const order = yield* configService.resolveOrder;
    const pluginsDirectory = yield* getPluginsDirectoryPath;

    for (const name of names) {
      yield* Console.log(
        formatPluginLine(name, `${pluginsDirectory}/${name}`, order),
      );
    }
  }),
).pipe(Command.withDescription('List installed plugins'));
