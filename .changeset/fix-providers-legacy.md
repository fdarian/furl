---
"furl-cli": minor
---

Deleting an Exa or Firecrawl key in `furl providers` now removes its `default:<provider>` token from `order` instead of switching to jina. `furl providers` migrates a legacy `provider` field to `order` right away, and saving a jina key prints a hint when `default:jina` isn't in `order`. Config writes keep unknown fields, and `--resolvers` runs no longer read or warn about the config file.
