---
"furl-cli": patch
---

Document the plugins design: host-matched resolver plugins authored with a `definePlugin` API, `~/.config/furl/plugins/` directory discovery, an `order` precedence grammar (`<id>` / `*` / `default:<name>` / `default:*`), and keychain-backed `"secret:<name>"` config references. Design only — see the **Plugins** docs section; no runtime change yet.
