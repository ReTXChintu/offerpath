/**
 * The private portfolio API's shapes (docs/portfolio.md, "Private API").
 * Every route is under `/portfolio` on the API's `/api/v1` base.
 */

export type SourceCollection = 'projects' | 'experiences' | 'skills';

/** The profile item a portfolio item came from. */
export type Source = { collection: SourceCollection; id: string } | null;

export interface SiteSocials {
  github: string;
  linkedin: string;
  twitter: string;
  email: string;
}

export interface SiteSettings {
  heroName: string;
  heroEyebrow: string;
  roles: string[];
  heroBio: string;
  resumeUrl: string;
  aboutHeadline: string;
  aboutParagraphs: string[];
  socials: SiteSocials;
}

export interface CloudinaryStatus {
  configured: boolean;
  cloudName: string | null;
  apiKeyLast4: string | null;
}

export interface PortfolioCounts {
  projects: number;
  drafts: number;
  skills: number;
  experience: number;
  developerTools: number;
  unreadMessages: number;
}

export interface PortfolioView {
  handle: string;
  settings: SiteSettings;
  cloudinary: CloudinaryStatus;
  /** '/api/v1/public/portfolio/<handle>/site', a path on the API's origin. */
  publicUrl: string;
  counts: PortfolioCounts;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectItem {
  id: string;
  title: string;
  desc: string;
  tags: string[];
  accent: string;
  gradientFrom: string;
  gradientTo: string;
  /** A project needs an image to be published. */
  imageUrl: string | null;
  liveUrl: string;
  githubUrl: string;
  domain: string;
  order: number;
  published: boolean;
  source: Source;
  /** Its text still follows the profile item it came from. */
  followsSource: boolean;
  /** The project's folder on the laptop, for mockups. */
  localPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillGroupItem {
  id: string;
  cat: string;
  items: string[];
  order: number;
  published: boolean;
  source: Source;
  followsSource: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExperienceItem {
  id: string;
  title: string;
  company: string;
  period: string;
  bullets: string[];
  order: number;
  published: boolean;
  source: Source;
  followsSource: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DeveloperToolItem {
  id: string;
  title: string;
  slug: string;
  shortDescription: string;
  fullDescription: string;
  domain: string;
  techStacks: string[];
  accent: string;
  gradientFrom: string;
  gradientTo: string;
  githubUrl: string;
  npmUrl: string;
  docsUrl: string;
  demoUrl: string;
  installCommand: string;
  packageName: string;
  version: string;
  featured: boolean;
  published: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface MessageItem {
  id: string;
  name: string;
  email: string;
  message: string;
  read: boolean;
  createdAt: string;
}

/** The four editable collections and their route segments. */
export interface CollectionItems {
  projects: ProjectItem;
  skills: SkillGroupItem;
  experience: ExperienceItem;
  'developer-tools': DeveloperToolItem;
}

export type CollectionKind = keyof CollectionItems;

type ServerFields = 'id' | 'source' | 'createdAt' | 'updatedAt';

/** What a create sends: the item's fields, minus the server's. */
export type ProjectInput = Omit<
  ProjectItem,
  ServerFields | 'order' | 'published' | 'followsSource'
>;
export type SkillGroupInput = Pick<SkillGroupItem, 'cat' | 'items'>;
export type ExperienceInput = Pick<ExperienceItem, 'title' | 'company' | 'period' | 'bullets'>;
export type DeveloperToolInput = Omit<DeveloperToolItem, 'id' | 'slug' | 'createdAt' | 'updatedAt'>;

export interface CollectionInputs {
  projects: ProjectInput;
  skills: SkillGroupInput;
  experience: ExperienceInput;
  'developer-tools': DeveloperToolInput;
}

/** A PATCH body: any subset of the fields, plus the publish and re-link switches. */
export type CollectionPatch<K extends CollectionKind> = Partial<CollectionInputs[K]> & {
  published?: boolean;
  followsSource?: boolean;
};
