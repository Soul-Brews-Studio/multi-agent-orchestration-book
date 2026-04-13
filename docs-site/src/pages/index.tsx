import type { ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/intro">
            Start Reading →
          </Link>
          <Link
            className="button button--outline button--secondary button--lg"
            to="/docs/ch01-why-one-agent-isnt-enough"
            style={{ marginLeft: '1rem' }}>
            Chapter 1
          </Link>
        </div>
      </div>
    </header>
  );
}

type FeatureItem = {
  title: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Battle-Tested Patterns',
    description: (
      <>
        Every pattern in this book has code that shipped. Every failure has a
        git commit. Every success has metrics from a real 100-hour session.
      </>
    ),
  },
  {
    title: 'Three Tiers of Orchestration',
    description: (
      <>
        From in-process subagents to coordinated teams to independent federation
        nodes — learn which tier fits which problem.
      </>
    ),
  },
  {
    title: 'The Human Factor',
    description: (
      <>
        Convenience is for the AI. Visibility is for the human. The best
        multi-agent systems serve both — this book shows you how.
      </>
    ),
  },
];

function Feature({ title, description }: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md" style={{ paddingTop: '1rem' }}>
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="A Practitioner's Guide from 100 Hours of Building multi-agent orchestration systems">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <div className="container" style={{ padding: '3rem 0', maxWidth: '700px', margin: '0 auto' }}>
          <Heading as="h2">About This Book</Heading>
          <p>
            This is not a theoretical treatise on multi-agent systems. It is a field guide
            written from a 100+ hour session where we used three distinct tiers of agent
            orchestration to ship a production-grade software system.
          </p>
          <blockquote>
            <p>Convenience is for the AI. Visibility is for the human. The best system serves both.</p>
          </blockquote>
          <p>
            Built on <strong>maw-js</strong>, a multi-agent workflow framework written in Bun + TypeScript.
            Every file path and commit hash in this book is real and reproducible.
          </p>
          <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <Link className="button button--primary" to="/docs/intro">Read the Introduction</Link>
            <Link className="button button--secondary" to="/docs/appendix-a-command-reference">Appendices</Link>
          </div>
        </div>
      </main>
    </Layout>
  );
}
