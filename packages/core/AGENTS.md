# furl-lib

- Purpose: runtime-agnostic fetch-to-markdown engine, published as `furl-lib`. It reads no files, keychain or config and uses no Bun API: callers pass resolver objects in. Config, order tokens (`default:*`), plugins and secrets belong to `apps/cli`.
- Stack: Effect v4, `effect/http`. HTTP goes through the `HttpClient` the caller provides.
- Key files:
  - `src/furl.ts` (`Furl` service, `Furl.layer`, `Furl.fetch`, `FurlError`)
  - `src/resolver.ts` (`Resolver` type, `ResolveSuccess` / `ResolveDecline`)
  - `src/resolvers.ts` (`Resolvers.*`: `raw`, `direct`, `mdSuffix`, `defaults`, `jina`, `exa`, `firecrawl`)
  - `src/engine.ts` (runs the list, skips resolvers whose `match` fails, collects `ResolverError`s)
  - `src/builtin/*` (keyless probes), `src/providers/*` (API providers; `api-key.ts` resolves `apiKey` or the env var)
  - `src/index.ts` (the public surface)
- Resolver ids are the public identity: `raw`, `direct`, `md-suffix`, `jina`, `exa`, `firecrawl`. `FetchResult.source` is the winning resolver's `id`; the CLI overrides ids with its order tokens.
- Packaging: `exports` points at `src/index.ts` for the monorepo; `publishConfig.exports` points at built `dist` (`tsconfig.build.json`, run by `prepack`). `check:tsc` also type-checks the build config with `types: []`, so a `Bun` or `process` global in shipped code fails the check.
