import type { InstallPreview } from '@furl/core';
import {
  PluginInstallError,
  PluginManager,
  redactUrlUserInfo,
} from '@furl/core';
import { Console, Effect, Option } from 'effect';
import { Argument, Command, Flag, Prompt } from 'effect/unstable/cli';

const installUrlArgument = Argument.String('url').pipe(
  Argument.withDescription('Git URL of the plugin repository to clone'),
);

const installYesFlag = Flag.Boolean('yes').pipe(
  Flag.withDefault(false),
  Flag.withAlias('y'),
  Flag.withDescription(
    "Skip the confirmation prompt and run the plugin's code immediately; required in non-interactive sessions",
  ),
);

const isInteractiveStdin = Effect.sync(() => process.stdin.isTTY === true);

export const describePreview = (preview: InstallPreview): string[] => [
  `Source: ${preview.url}`,
  ...Option.match(preview.packageName, {
    onNone: () => [],
    onSome: (name) => [`Package: ${name}`],
  }),
  ...Option.match(preview.packageDescription, {
    onNone: () => [],
    onSome: (description) => [`Description: ${description}`],
  }),
];

export const pluginsInstallCommand = Command.make(
  'install',
  { url: installUrlArgument, yes: installYesFlag },
  (commandConfig) =>
    Effect.gen(function* () {
      const manager = yield* PluginManager;

      if (!commandConfig.yes && !(yield* isInteractiveStdin)) {
        return yield* new PluginInstallError({
          url: redactUrlUserInfo(commandConfig.url),
          cause: new Error(
            "Refusing to run this plugin's code without confirmation in a non-interactive session; re-run with --yes to confirm.",
          ),
        });
      }

      const outcome = yield* manager.install(commandConfig.url, (preview) =>
        Effect.gen(function* () {
          for (const line of describePreview(preview)) {
            yield* Console.log(line);
          }

          if (commandConfig.yes) {
            return true;
          }

          return yield* Prompt.Confirm({
            message: "Install this plugin? This will run the plugin's code.",
            initial: false,
          });
        }),
      );

      if (outcome.status === 'cancelled') {
        yield* Console.log('Install cancelled.');
        return;
      }

      yield* Console.log(`Installed "${outcome.name}" to ${outcome.folder}.`);
    }),
).pipe(
  Command.withDescription(
    'Clone a plugin repository into the plugins directory',
  ),
);
