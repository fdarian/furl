# @furl/cli

- Purpose: Bun CLI for fetching URLs as markdown and managing plugins and secrets/provider keys.
- Commands:
  - `furl <url>`
  - `furl providers` for key storage and default-provider selection
  - `furl plugins` to configure a plugin's fields; `install`/`list`/`uninstall` subcommands
  - `furl secrets set <name>` stores a keychain secret that plugin config references as `"secret:<name>"`
- Dev command:
  - `bun run src/main.ts <url>`
- Key files:
  - `src/main.ts`
  - `package.json`
