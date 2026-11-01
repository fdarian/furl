import { directResolver } from './builtin/direct.ts';
import { mdSuffixResolver } from './builtin/md-suffix.ts';
import { rawResolver } from './builtin/raw.ts';
import { exaResolver } from './providers/exa.ts';
import { firecrawlResolver } from './providers/firecrawl.ts';
import { jinaResolver } from './providers/jina.ts';
import type { Resolver } from './resolver.ts';

/** The keyless built-in chain: `raw`, `direct`, then `md-suffix`. */
const defaults: readonly Resolver[] = [
  rawResolver,
  directResolver,
  mdSuffixResolver,
];

export const Resolvers = {
  raw: rawResolver,
  direct: directResolver,
  mdSuffix: mdSuffixResolver,
  defaults: defaults,
  jina: jinaResolver,
  exa: exaResolver,
  firecrawl: firecrawlResolver,
} as const;
