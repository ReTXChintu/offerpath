import { describeError, useLearnNavigator } from '@offerpath/learn';
import {
  Alert,
  Button,
  PageHeader,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@offerpath/ui';

import { portfolioPaths, type PortfolioTab } from '../context';
import { usePortfolio } from '../queries';

import { DeveloperToolsSection } from './DeveloperTools';
import { ExperienceSection } from './Experience';
import { MessagesSection } from './Messages';
import { Overview } from './Overview';
import { ProjectsSection } from './Projects';
import { PortfolioSetup } from './Setup';
import { SiteSettingsSection } from './SiteSettings';
import { SkillsSection } from './Skills';

const TAB_LABELS: Record<PortfolioTab, string> = {
  overview: 'Overview',
  settings: 'Site settings',
  projects: 'Projects',
  skills: 'Skills',
  experience: 'Experience',
  tools: 'Developer tools',
  messages: 'Messages',
};

/**
 * The Portfolio section: the setup until there's a portfolio, then one tab
 * per part of the site. Each tab has its own path (`/portfolio/projects`),
 * so a link (or the phone's push) can open it.
 */
export function PortfolioPage({ tab = 'overview' }: { tab?: PortfolioTab }) {
  const navigator = useLearnNavigator();
  const portfolio = usePortfolio();

  const header = (
    <PageHeader
      title="Portfolio"
      subtitle="Your portfolio site's content: what it shows, in what order, and the messages it brings in."
    />
  );

  if (portfolio.isLoading) {
    return (
      <div>
        {header}
        <Spinner label="Loading your portfolio" />
      </div>
    );
  }
  if (portfolio.error) {
    return (
      <div>
        {header}
        <Alert
          status="error"
          actions={
            <Button size="sm" onClick={() => void portfolio.refetch()}>
              Try again
            </Button>
          }
        >
          {describeError(portfolio.error, 'Your portfolio did not load.')}
        </Alert>
      </div>
    );
  }
  const view = portfolio.data;
  if (!view) {
    return (
      <div>
        {header}
        <PortfolioSetup />
      </div>
    );
  }

  return (
    <div>
      {header}
      <Tabs
        value={tab}
        onValueChange={(next) => navigator.navigate(portfolioPaths.tab(next as PortfolioTab))}
      >
        <TabsList label="Portfolio">
          {(Object.keys(TAB_LABELS) as PortfolioTab[]).map((key) => (
            <TabsTrigger
              key={key}
              value={key}
              count={
                key === 'messages' && view.counts.unreadMessages
                  ? view.counts.unreadMessages
                  : undefined
              }
            >
              {TAB_LABELS[key]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <Overview view={view} />
        </TabsContent>
        <TabsContent value="settings">
          <SiteSettingsSection settings={view.settings} />
        </TabsContent>
        <TabsContent value="projects">
          <ProjectsSection />
        </TabsContent>
        <TabsContent value="skills">
          <SkillsSection />
        </TabsContent>
        <TabsContent value="experience">
          <ExperienceSection />
        </TabsContent>
        <TabsContent value="tools">
          <DeveloperToolsSection />
        </TabsContent>
        <TabsContent value="messages">
          <MessagesSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
