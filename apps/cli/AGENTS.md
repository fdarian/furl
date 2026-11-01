# @furl/cli

- Purpose: Bun CLI for fetching URLs as markdown and managing plugins and secrets/provider keys.
- Commands:
  - `furl <url>`
  - `furl providers` for key storage and default-provider selection
  - `furl plugins` to configure a plugin's fields; `install`/`list`/`uninstall` subcommands
  - `furl secrets set <name>` stores a keychain secret that plugin config references as `"secret:<name>"`
- Dev command:
  - `bun run src/main.ts <url>`
- Build: `bun build --target=bun` into `dist/cli.js` with a Bun shebang, because the CLI uses Bun-only APIs (`@effect/platform-bun`, `Bun.secrets` for the keychain); it is not a Node bundle. `build:binaries` compiles the release tarballs.
- Builds the resolver list and hands it to `furl-core` (`Furl.fetch(url, { resolvers })`): `default:*` tokens expand to the `furl-core` built-ins under ids like `default:raw`, plugins become `plugin:<name>`, and provider keys come from env first, then the keychain.
- Key files:
  - `src/main.ts` (layers: Bun services, config, secrets, plugins and `FetchHttpClient.layer`, which `Furl.fetch` requires)
  - `src/commands/root.ts` (the fetch command)
  - `src/plugin/*` (`load-resolvers.ts` turns the order into resolvers and discovers plugins only when the order names one; also discovery, loader, manager, order parsing, `default-resolvers.ts`)
  - `src/config-service.ts`, `src/secrets-service.ts`, `src/errors.ts`
  - `src/plugins.ts` (the `furl-cli/plugins` surface; imports nothing so plugin authors need no other package)
  - `package.json`
