---
"furl-cli": patch
---

Plugin authors no longer need `furl-core` installed for types: `furl-cli/plugins` ships its own `definePlugin`, `ConfigField`, `MatchPattern`, `PluginManifest`, `PluginResolveResult` and `ResolveContext` types, so `furl-cli` alone is enough under npm and pnpm.
