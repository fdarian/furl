import type { SecretsService } from '../../secrets-service.ts';
import type { Resolver } from '../resolver.ts';

import { directResolver } from './direct.ts';
import { exaResolver } from './exa.ts';
import { firecrawlResolver } from './firecrawl.ts';
import { jinaResolver } from './jina.ts';
import { mdSuffixResolver } from './md-suffix.ts';
import { rawResolver } from './raw.ts';
import type { HttpClientService } from './shared.ts';

export const createDefaultResolvers = (
  client: HttpClientService,
  secrets: SecretsService,
): Resolver[] => [
  rawResolver(client),
  directResolver(client),
  mdSuffixResolver(client),
  jinaResolver(client, secrets),
  exaResolver(client, secrets),
  firecrawlResolver(client, secrets),
];
