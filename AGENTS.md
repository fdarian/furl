# furl

- Purpose: pnpm + Turborepo monorepo for the `furl` CLI (Bun) and `furl-lib`, the runtime-agnostic fetch engine.
- Workspaces: `apps/cli`, `packages/core`, `packages/config`.
- Tooling: pnpm (package manager), Bun (CLI runtime and test runner), Turborepo, Biome, TypeScript, Effect v4.
- Root commands:
  - `pnpm install`
  - `pnpm run check` (every package's `check:type`, `check:lint` and `test`)
  - `pnpm run format`
- CI: `.github/workflows/ci.yml` auto-commits formatting, then runs `turbo run check --affected`. `.github/workflows/release.yml` is driven by Changesets: `ci:release` builds `furl-lib` and `furl-cli`, then `changeset publish` over npm OIDC (no token).
- Key files:
  - `package.json`
  - `turbo.jsonc`
  - `biome.jsonc`
  - `packages/config/*`
