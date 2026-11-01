---
"furl-lib": minor
---

First public release of `furl-lib`: the furl fetch engine as a runtime-agnostic Effect library for Node 20+ and Bun, shipped as built ES modules with type declarations. Build the service with `Furl.layer({ resolvers })` and an `HttpClient` such as `FetchHttpClient.layer`, then call `Furl.fetch(url)` to get `{ markdown, source }`, where `source` is the winning resolver's `id`. Resolvers are plain objects: use `Resolvers.defaults` (`raw`, `direct`, `md-suffix`), add `Resolvers.jina`, `Resolvers.exa` or `Resolvers.firecrawl` with an optional `apiKey` (a string, or an Effect returning an `Option<string>`; the provider's environment variable is read when it is omitted), or write your own, and replace the list for one call with `Furl.fetch(url, { resolvers })`. The library reads no config file, keychain or plugin folder. `effect` is a peer dependency.
