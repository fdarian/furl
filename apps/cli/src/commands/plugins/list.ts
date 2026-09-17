import {
  FurlConfigService,
  PluginDiscovery,
  pluginOrderToken,
} from '@furl/core';
import { Console, Effect } from 'effect';
import { Command } from 'effect/unstable/cli';

const getPluginStatusTitle = (name: string, enabled: boolean): string =>
  `${name}  (${enabled ? 'enabled' : 'disabled'})`;

export const pluginsListCommand = Command.make('list', {}, () =>
  Effect.gen(function* () {
    const discovery = yield* PluginDiscovery;
    const configService = yield* FurlConfigService;

    const plugins = yield* discovery.discover;

    if (plugins.length === 0) {
      yield* Console.log(
        'No plugins installed. Run `furl plugins install <git-url>` to add one.',
      );
      return;
    }

    const order = yield* configService.resolveOrder;

    for (const plugin of plugins) {
      const enabled = order.includes(pluginOrderToken(plugin.manifest.name));
      const status = getPluginStatusTitle(plugin.manifest.name, enabled);
      yield* Console.log(`${status} - ${plugin.folder}`);
    }
  }),
).pipe(Command.withDescription('List installed plugins'));
