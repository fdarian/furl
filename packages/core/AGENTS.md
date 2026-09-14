# @furl/core

- Purpose: Fetch-to-markdown engine and provider integrations for `furl`.
- Stack: Effect v4 beta, `effect/unstable/http`, Bun keychain + filesystem services.
- Key files:
  - `src/fetch-markdown.ts`
  - `src/config-service.ts`
  - `src/secrets-service.ts`
  - `src/providers/*`
- Default chain (`default:*`): raw extension passthrough, direct `Accept: text/markdown`, then `.md` suffix retry. API providers (`jina`, `exa`, `firecrawl`) are selected explicitly with `default:<name>`.
