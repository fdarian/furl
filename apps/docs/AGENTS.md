# @furl/docs

- Purpose: Blume documentation site for `furl`, styled by `@fdarian/blume-preset`.
- Dev command:
  - `pnpm dev`
- Build command:
  - `pnpm build`
- Pages live in:
  - `src/pages/**/*.mdx` (title/description in frontmatter; callouts and steps use Blume components)
- Key files:
  - `blume.config.ts` (site config + sidebar, wrapped in `withPreset`)
  - `theme.css`, `components.ts` (wiring only; the look lives in the preset)
  - `tsconfig.json`
