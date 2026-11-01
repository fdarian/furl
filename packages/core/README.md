# furl-core

Fetch any URL as markdown, through a pluggable chain of resolvers. Built on [Effect](https://effect.website). The engine behind the [`furl`](https://www.npmjs.com/package/furl-cli) CLI.

It runs on Node 20+ and Bun, as an ES module, and reads no config file or keychain: the resolvers are plain objects you pass in.

## Install

```sh
npm i furl-core effect
```

`effect` (v4, 4.1.0 or newer) is a peer dependency, so your app and `furl-core` share one Effect runtime.

## Usage

```ts
import { Furl } from 'furl-core';
import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/http';

const result = await Effect.runPromise(
  Furl.fetch('https://bun.sh/docs.md').pipe(Effect.provide(FetchHttpClient.layer)),
);
console.log(result.source, result.markdown);
```

furl uses whatever `HttpClient` you provide, so your app's tracing, retries or proxy apply to its requests. `FetchHttpClient` is the one that uses the runtime's global `fetch`.

`source` is the `id` of the resolver that produced the markdown, such as `raw`. `Resolvers.defaults` are the three keyless probes; to run a different list, provide `Furl.layer({ resolvers })` or pass `{ resolvers }` to `Furl.fetch`. `Resolvers.jina`, `Resolvers.exa` and `Resolvers.firecrawl` add API providers, and a resolver is a plain object you can write yourself.

See the [library docs](https://furl.fdarian.com/library/getting-started) for resolvers, API keys and errors.

## License

Apache-2.0
