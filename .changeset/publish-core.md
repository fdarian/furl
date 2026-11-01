---
"@furl/core": minor
---

First public release of `@furl/core`: the furl fetch engine as a Bun-only library that ships TypeScript source. Provide `FurlLive` with Bun services and an HTTP client, then call `Furl.fetch(url, { resolvers })` to get markdown. `definePlugin` is available from `@furl/core/plugins`. `effect` is a peer dependency.
