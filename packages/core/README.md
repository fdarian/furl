# furl-lib

Fetch any URL as markdown, through a pluggable chain of resolvers. Built on [Effect](https://effect.website). The engine behind the [`furl`](https://www.npmjs.com/package/furl-cli) CLI.

It runs on Node 20+ and Bun, as an ES module, and reads no config file or keychain: the resolvers are plain objects you pass in. No layer or HTTP client is needed to start: `Furl.fetch` uses the keyless defaults over the global `fetch`.

## Install

```sh
npm i furl-lib effect
```

`effect` (v4, 4.1.0 or newer) is a peer dependency, so your app and `furl-lib` share one Effect runtime.

## Usage

```ts
import { Furl } from 'furl-lib';
import { Effect } from 'effect';

const result = await Effect.runPromise(Furl.fetch('https://bun.sh/docs.md'));
console.log(result.source, result.markdown);
```

`source` is the `id` of the resolver that produced the markdown, such as `raw`. `Resolvers.defaults` are the three keyless probes; to run a different list, provide `Furl.layer({ resolvers })` or pass `{ resolvers }` to `Furl.fetch`. `Resolvers.jina`, `Resolvers.exa` and `Resolvers.firecrawl` add API providers, and a resolver is a plain object you can write yourself.

See the [library docs](https://furl.fdarian.com/library/getting-started) for resolvers, API keys and errors.

## License

Apache-2.0
