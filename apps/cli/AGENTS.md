# @furl/cli

- Purpose: Bun CLI for fetching URLs as markdown, managing plugins, and managing secrets/provider keys.
- Commands:
  - `furl <url>` — accepts `--plugin <id>` (force one resolver) and `--no-plugins` (built-ins only)
  - `furl plugins` — interactive enable/disable/configure; `install <url>` / `uninstall <id>` / `list` subcommands
  - `furl secrets set <name>` — store a secret in the OS keychain for `"secret:<name>"` config refs
  - `furl providers` — deprecated alias, kept working; superseded by `furl plugins` (built-ins are `default:` resolvers)
- Dev command:
  - `bun run src/main.ts <url>`
- Key files:
  - `src/main.ts` — layer graph; `PluginLoaderLive` registers the `furl-cli/plugins` Bun virtual module once, shared (memoized) between `Furl`'s internal chain and the top-level `PluginDiscovery`/`PluginLoader` used by `plugins.ts`
  - `src/commands/root.ts`, `src/commands/plugins.ts`, `src/commands/secrets.ts`, `src/commands/providers.ts`
  - `package.json`
