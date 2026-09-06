import { defineConfig } from 'vocs/config';

export default defineConfig({
  title: 'furl',
  description:
    'A curl replacement for AI agents — fetch any URL as clean markdown.',
  sidebar: [
    {
      text: 'Introduction',
      collapsed: false,
      items: [
        { text: 'What is furl?', link: '/' },
        {
          text: 'Fetch strategy',
          link: '/fetch-strategy',
        },
      ],
    },
    {
      text: 'Plugins',
      collapsed: false,
      items: [
        { text: 'Overview', link: '/plugins/overview' },
        { text: 'Getting Started', link: '/plugins/getting-started' },
        {
          text: 'Builtins',
          collapsed: false,
          items: [
            { text: 'jina', link: '/plugins/builtins/jina' },
            { text: 'exa', link: '/plugins/builtins/exa' },
            { text: 'firecrawl', link: '/plugins/builtins/firecrawl' },
          ],
        },
        { text: 'Create your own', link: '/plugins/create-your-own' },
      ],
    },
  ],
});
