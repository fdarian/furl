# @furl/core

- Purpose: Fetch-to-markdown engine and provider integrations for `furl`.
- Stack: Effect v4 beta, `effect/unstable/http`, Bun keychain + filesystem services.
- Key files:
  - `src/fetch-markdown.ts`
  - `src/config-service.ts`
  - `src/secrets-service.ts`
  - `src/providers/*`
- Fallback chain:
  - raw extension passthrough
  - direct `Accept: text/markdown`
  - `.md` suffix retry
  - provider fallback (`jina`, `exa`, `firecrawl`)
