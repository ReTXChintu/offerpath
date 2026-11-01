/**
 * @offerpath/portfolio: the Portfolio section (docs/portfolio.md), shared by
 * the web app and the laptop app. It edits the content a user's portfolio
 * site reads from Offerpath's public API: site settings, projects, skills,
 * experience, developer tools, and the contact form's messages.
 *
 * Requests go through the learning side's client, so mount the pages inside
 * `<LearnProvider>`; host extras (the API's origin, the laptop's folder
 * picker and project tools) come through `<PortfolioProvider>`. Import
 * `@offerpath/portfolio/styles.css` once, after `@offerpath/ui/styles.css`.
 */
export {
  PORTFOLIO_TABS,
  PortfolioProvider,
  parsePortfolioTab,
  portfolioPaths,
  usePortfolioHost,
  type PortfolioHost,
  type PortfolioTab,
  type ProjectToolsProps,
} from './context';
export * from './queries';
export type * from './types';
export {
  handleProblem,
  isHexColour,
  netlifySnippet,
  normaliseHex,
  originOf,
  publicSiteUrl,
} from './lib/format';

// Pages
export { PortfolioPage } from './features/PortfolioPage';
