---
"furl-cli": minor
---

Add a plugin system: author host-matched resolvers with `definePlugin` (import from `furl-cli/plugins`), drop them in `~/.config/furl/plugins/<folder>/`, and furl discovers, type-checks, and runs them ahead of its built-in fetch strategies.

- **`order` grammar** — a `config.json` `order` array of `<id>` / `*` / `default:<name>` / `default:*` tokens controls resolver precedence per URL; unset, it defaults to `['*', 'default:*']` (matching plugins, then furl's built-ins).
- **`default:` built-ins** — the existing fetch chain (`raw`, `direct`, `md-suffix`, `jina`, `exa`, `firecrawl`) is now addressable in `order` as `default:raw`, `default:direct`, etc., or as a group via `default:*`.
- **`furl plugins`** — interactive install (`furl plugins install <git-url>`), uninstall, list, enable/disable, and per-plugin config form, backed by the plugin's manifest `config` fields.
- **`furl secrets set <name>`** — stores a value in the OS keychain (`com.fdarian.furl`) for `"secret:<name>"` references in plugin config, resolved just before a plugin's `resolve` runs.
- **`furl <url>`** gains `--plugin <id>` (force a single resolver by its bare id — a plugin name or a built-in like `jina`, bypassing the order chain) and `--no-plugins` (run the built-in chain only); `-p/--provider` is now a deprecated shorthand for `--plugin <name>`.
- `furl providers` keeps working as a deprecated alias for managing jina/exa/firecrawl keys.
