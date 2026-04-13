import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Multi-Agent Orchestration',
  tagline: 'A Practitioner\'s Guide from 100 Hours of Building',
  favicon: 'img/favicon.ico',

  url: 'https://soul-brews-studio.github.io',
  baseUrl: '/multi-agent-orchestration-book/',

  organizationName: 'Soul-Brews-Studio',
  projectName: 'multi-agent-orchestration-book',
  trailingSlash: false,

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  // Treat .md files as CommonMark (not MDX) to avoid JSX-parse errors
  // from generics like maw.fetch<T>() in prose and code examples
  markdown: {
    format: 'detect',
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/Soul-Brews-Studio/multi-agent-orchestration-book/tree/main/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Multi-Agent Orchestration',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'bookSidebar',
          position: 'left',
          label: 'Book',
        },
        {
          href: 'https://github.com/Soul-Brews-Studio/multi-agent-orchestration-book',
          position: 'right',
          className: 'header-github-link',
          'aria-label': 'GitHub repository',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Book',
          items: [
            {
              label: 'Part I: Foundations',
              to: '/docs/ch01-why-one-agent-isnt-enough',
            },
            {
              label: 'Part II: Patterns',
              to: '/docs/ch05-the-research-swarm',
            },
            {
              label: 'Part III: Infrastructure',
              to: '/docs/ch10-the-plugin-architecture',
            },
            {
              label: 'Part IV: The Human Factor',
              to: '/docs/ch13-what-the-human-sees',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/Soul-Brews-Studio/multi-agent-orchestration-book',
            },
          ],
        },
      ],
      copyright: 'MIT licensed · Written by multi-agent teams',
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'typescript', 'json', 'rust'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
