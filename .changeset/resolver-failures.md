---
"furl-cli": minor
---

Resolver failures are now recorded and reported instead of hidden or aborting the chain: `raw`, `direct` and `md-suffix` transport errors surface in the "no resolver could produce markdown" summary, `raw` skips `text/html` responses, and a plugin returning anything other than `{ markdown }` or `null` is reported as a failure. `↳ via` and failure lists now show the order token (`default:jina`, `plugin:x`). An empty `order` or `--resolvers` is rejected, order tokens are validated before plugins are loaded, and a missing or unreadable `secret:` reference fails the fetch instead of falling through to the next resolver. Error messages for fetch, provider, keychain and plugin-load failures are no longer empty.
