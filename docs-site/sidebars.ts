import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  bookSidebar: [
    {
      type: 'doc',
      id: 'intro',
      label: 'Introduction',
    },
    {
      type: 'category',
      label: 'Part I: Foundations',
      collapsed: false,
      items: [
        'ch01-why-one-agent-isnt-enough',
        'ch02-the-three-tiers',
        'ch03-the-message-bus',
        'ch04-task-tracking',
      ],
    },
    {
      type: 'category',
      label: 'Part II: Patterns',
      collapsed: false,
      items: [
        'ch05-the-research-swarm',
        'ch06-the-architecture-debate',
        'ch07-the-implementation-team',
        'ch08-the-federation-agent',
        'ch09-the-cron-loop',
      ],
    },
    {
      type: 'category',
      label: 'Part III: Infrastructure',
      collapsed: false,
      items: [
        'ch10-the-plugin-architecture',
        'ch11-wasm-plugin-runtime',
        'ch12-framework-migration-with-agents',
      ],
    },
    {
      type: 'category',
      label: 'Part IV: The Human Factor',
      collapsed: false,
      items: [
        'ch13-what-the-human-sees',
        'ch14-failure-modes',
        'ch15-the-future-tier-4',
      ],
    },
    {
      type: 'category',
      label: 'Appendices',
      collapsed: true,
      items: [
        'appendix-a-command-reference',
        'appendix-b-spawn-pattern-cheatsheet',
        'appendix-c-cost-analysis',
        'appendix-d-plugin-catalog',
      ],
    },
    {
      type: 'category',
      label: 'Origin Story',
      collapsed: true,
      items: [
        'origin',
      ],
    },
  ],
};

export default sidebars;
