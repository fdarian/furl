---
"furl-cli": minor
---

`furl plugins` no longer crashes when prompting for a string, number or secret field, and the form is more careful: a required secret with nothing stored is asked again, secrets are written to the keychain only after every field is answered, optional booleans and numbers can be skipped, and a saved enum choice is preselected. Secrets set with `furl secrets set <name>` (and `secret:<name>` references) now live in their own keychain namespace, separate from the `exa`, `firecrawl` and `jina` provider keys, so previously stored generic secrets must be set again; empty names and values are rejected. Plugin manifests are validated: the name must match `^[a-z0-9][a-z0-9_-]*$` and `config` fields need a safe `key`, a known `type`, and non-empty `options` for enums. `furl plugins uninstall` now deletes every `secret:<plugin>.*` reference in the plugin's saved config.
