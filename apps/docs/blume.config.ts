import { withPreset } from '@fdarian/blume-preset';
import { defineConfig } from 'blume';
import { filesystem } from 'blume/sources';

export default defineConfig(
  withPreset({
    title: 'furl',
    description:
      'A curl replacement for AI agents — fetch any URL as clean markdown.',
    content: {
      sources: [filesystem({ root: 'src/pages' })],
    },
    navigation: {
      sidebar: [
        {
          label: 'Introduction',
          items: [
            { label: 'What is furl?', href: '/' },
            { label: 'Fetch strategy', href: '/fetch-strategy' },
          ],
        },
        {
          label: 'Plugins',
          items: [
            { label: 'Overview', href: '/plugins/overview' },
            { label: 'Getting Started', href: '/plugins/getting-started' },
            {
              label: 'Builtins',
              items: [
                { label: 'jina', href: '/plugins/builtins/jina' },
                { label: 'exa', href: '/plugins/builtins/exa' },
                { label: 'firecrawl', href: '/plugins/builtins/firecrawl' },
              ],
            },
            { label: 'Create your own', href: '/plugins/create-your-own' },
          ],
        },
      ],
    },
  }),
);
