---
"furl-cli": patch
---

`furl providers`' "Set as default" now actually changes resolution: it inserts `default:<name>` into the `order` config, ahead of the other providers but still behind the free `raw`/`direct`/`md-suffix` probes, instead of writing the old `provider` field, which the fetch chain stopped reading once `order` shipped — previously the command reported success but changed nothing. Providers stay behind the free probes so setting a default never makes a plain fetch pay for a paid or rate-limited call the probes could have handled for free. A `provider` field left over from an older `config.json` is still honored the same way (folded into `order` on read, with a deprecation notice) instead of being silently ignored.
