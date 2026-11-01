# @furl/core

Fetch any URL as markdown, through a pluggable chain of resolvers. Built on [Effect](https://effect.website). The engine behind the [`furl`](https://www.npmjs.com/package/furl-cli) CLI.

Bun only: the package ships TypeScript source and uses `Bun.secrets` (Bun 1.2.21 or newer).

## Install

```sh
bun add @furl/core effect @effect/platform-bun
```

`effect` is a peer dependency, so your app and `@furl/core` share one Effect runtime. Install the same version for `effect` and `@effect/platform-bun`.

## Usage

```ts
import { BunServices } from '@effect/platform-bun';
import { Furl, FurlLive } from '@furl/core';
import { Effect, Layer } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';

const layer = FurlLive.pipe(
  Layer.provide(Layer.mergeAll(BunServices.layer, FetchHttpClient.layer)),
);

const program = Effect.gen(function* () {
  const furl = yield* Furl;
  return yield* furl.fetch('https://bun.sh/docs.md', {
    resolvers: ['default:*'],
  });
});

const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
console.log(result.source, result.markdown);
```

See the [library docs](https://furl.fdarian.com/library/getting-started) for resolvers, plugins and configuration.

## License

Apache-2.0
