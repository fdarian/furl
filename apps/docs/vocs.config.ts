import { defineConfig } from 'vocs/config';

export default defineConfig({
  title: 'furl',
  description:
    'A curl replacement for AI agents — fetch any URL as clean markdown.',
  sidebar: [
    { text: 'Introduction', link: '/' },
    { text: 'Getting Started', link: '/getting-started' },
    { text: 'Fetching pages', link: '/fetching' },
    { text: 'How furl finds markdown', link: '/how-it-works' },
    { text: 'Providers', link: '/providers' },
  ],
});
