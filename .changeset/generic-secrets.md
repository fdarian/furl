---
"furl-cli": minor
---

Plugin config values written as `"secret:<name>"` are resolved from the OS keychain before the plugin runs. Add `furl secrets set <name>` to store a secret, and let `furl plugins` prompt for a plugin's declared config fields, saving `secret` fields to the keychain as `<plugin>.<field>`. `furl plugins uninstall` now also deletes the plugin's keychain secrets.
