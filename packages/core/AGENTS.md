# @furl/core

- Purpose: Fetch-to-markdown engine and provider integrations for `furl`.
- Stack: Effect v4 beta, `effect/unstable/http`, Bun keychain + filesystem services.
- Key files:
  - `src/fetch-markdown.ts`
  - `src/config-service.ts`
  - `src/secrets-service.ts`
  - `src/providers/*`
- Default chain (`raw` -> `direct` -> `md-suffix`): raw extension passthrough, then direct `Accept: text/markdown`, then a `.md` suffix retry.
- `jina`/`exa`/`firecrawl` are opt-in providers, not part of the default chain — reachable via `default:<name>`/`default:*` in `order` or `--plugin <name>`. See `src/plugin/default/shared.ts` and `src/config-service.ts`.
