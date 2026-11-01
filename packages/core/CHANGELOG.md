# furl-core

## 0.1.0

### Minor Changes

- d8d977a: First public release of `furl-core`: the furl fetch engine as a runtime-agnostic Effect library for Node 20+ and Bun, shipped as built ES modules with type declarations. Call `Furl.fetch(url)` with no setup and provide an `HttpClient` such as `FetchHttpClient.layer` (the runtime's global `fetch`) to get `{ markdown, source }`, where `source` is the winning resolver's `id`; the client you provide is the one furl uses, so your app's tracing, retries or proxy apply. `Furl.layer({ resolvers })` is the optional way to change the default resolver list. Resolvers are plain objects: use `Resolvers.defaults` (`raw`, `direct`, `md-suffix`), add `Resolvers.jina`, `Resolvers.exa` or `Resolvers.firecrawl` with an optional `apiKey` (a string, or an Effect returning an `Option<string>`; the provider's environment variable is read when it is omitted), or write your own, and replace the list for one call with `Furl.fetch(url, { resolvers })`. The library reads no config file, keychain or plugin folder. `effect` is a peer dependency.
