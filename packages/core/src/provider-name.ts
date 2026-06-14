import { Schema } from 'effect';

export const providerSchema = Schema.Literals(['jina', 'exa', 'firecrawl']);

export type ProviderName = 'jina' | 'exa' | 'firecrawl';
