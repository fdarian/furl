import { defineConfig } from 'vocs/config';

export default defineConfig({
  title: 'furl',
  description:
    'A curl replacement for AI agents — fetch any URL as clean markdown.',
  sidebar: [
    { text: 'Introduction', link: '/' },
    { text: 'Getting Started', link: '/getting-started' },
    { text: 'How it works', link: '/how-it-works' },
    { text: 'Providers', link: '/providers' },
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
            {
              text: 'Fetch strategies',
              link: '/plugins/builtins/fetch-strategies',
            },
            { text: 'jina', link: '/plugins/builtins/jina' },
            { text: 'exa', link: '/plugins/builtins/exa' },
            { text: 'firecrawl', link: '/plugins/builtins/firecrawl' },
          ],
        },
        { text: 'Create your own', link: '/plugins/create-your-own' },
      ],
    },
    { text: 'Architecture', link: '/architecture' },
  ],
});
