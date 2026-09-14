---
"furl-cli": minor
---

API providers are now opt-in: a config without an `order` uses only `default:*` (raw, direct, and `.md`-suffix probes), so API keys alone never trigger a third-party request. Selecting a provider with `furl providers` writes its `default:<name>` token into `order`. Configs with the legacy `provider` field are migrated to that order on read/write, with `order` taking precedence when both fields exist. The `--provider` flag remains a deprecated per-call alias for `default:*` plus the selected provider.
