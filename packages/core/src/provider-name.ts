import { Schema } from 'effect';

export const providerNames = ['jina', 'exa', 'firecrawl'] as const;

export const providerSchema = Schema.Literals(providerNames);

export type ProviderName = (typeof providerNames)[number];
