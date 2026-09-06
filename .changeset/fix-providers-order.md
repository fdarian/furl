---
"furl-cli": patch
---

`furl providers`' "Set as default" now actually changes resolution: it puts `default:<name>` at the front of the `order` config instead of writing the old `provider` field, which the fetch chain stopped reading once `order` shipped — previously the command reported success but changed nothing. A `provider` field left over from an older `config.json` is still honored (folded into `order` on read, with a deprecation notice) instead of being silently ignored.
