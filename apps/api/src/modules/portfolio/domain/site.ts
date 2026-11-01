/**
 * The public portfolio contract (docs/portfolio.md): what a portfolio site
 * reads from `GET /public/portfolio/:handle/site`. Pure, so the shapes,
 * defaults, filters and order are pinned by unit tests.
 */

export const HEX = /^#[0-9a-f]{6}$/i;

export interface SiteSettings {
  heroName: string;
  heroEyebrow: string;
  roles: string[];
  heroBio: string;
  resumeUrl: string;
  aboutHeadline: string;
  aboutParagraphs: string[];
  socials: { github: string; linkedin: string; twitter: string; email: string };
}

export interface SiteData {
  settings: SiteSettings;
  projects: {
    _id: string;
    title: string;
    desc: string;
    tags: string[];
    accent: string;
    gradientFrom: string;
    gradientTo: string;
    imageUrl: string;
    liveUrl: string;
    githubUrl: string;
    domain: string;
  }[];
  developerTools: {
    _id: string;
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
  }[];
  skills: { _id: string; cat: string; items: string[] }[];
  experience: { _id: string; title: string; company: string; period: string; bullets: string[] }[];
}

/** The settings columns of a portfolio row. */
export interface SettingsRow {
  heroName: string;
  heroEyebrow: string;
  roles: string[];
  heroBio: string;
  resumeUrl: string;
  aboutHeadline: string;
  aboutParagraphs: string[];
  socialGithub: string;
  socialLinkedin: string;
  socialTwitter: string;
  socialEmail: string;
}

interface Ordered {
  id: string;
  published: boolean;
  createdAt: Date;
}

export interface ProjectRow extends Ordered {
  title: string;
  desc: string;
  tags: string[];
  accent: string;
  gradientFrom: string;
  gradientTo: string;
  imageUrl: string | null;
  liveUrl: string;
  githubUrl: string;
  domain: string;
  order: number;
}

export interface SkillRow extends Ordered {
  cat: string;
  items: string[];
  order: number;
}

export interface ExperienceRow extends Ordered {
  title: string;
  company: string;
  period: string;
  bullets: string[];
  order: number;
}

export interface ToolRow extends Ordered {
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
  sortOrder: number;
}

export function siteSettings(row: SettingsRow): SiteSettings {
  const heroEyebrow = row.heroEyebrow.trim() || 'Developer';
  const roles = row.roles.map((r) => r.trim()).filter(Boolean);
  return {
    heroName: row.heroName.trim(),
    heroEyebrow,
    roles: roles.length > 0 ? roles : [heroEyebrow],
    heroBio: row.heroBio.trim(),
    resumeUrl: row.resumeUrl.trim() || '#',
    aboutHeadline: row.aboutHeadline.trim(),
    aboutParagraphs: row.aboutParagraphs.map((p) => p.trim()).filter(Boolean),
    socials: {
      github: row.socialGithub.trim() || '#',
      linkedin: row.socialLinkedin.trim() || '#',
      twitter: row.socialTwitter.trim() || '#',
      email: row.socialEmail.trim() || '#',
    },
  };
}

/** By `key` ascending, then newest first: the order the old admin used. */
function sorted<T extends { createdAt: Date }>(rows: T[], key: (r: T) => number): T[] {
  return [...rows].sort((a, b) => key(a) - key(b) || b.createdAt.getTime() - a.createdAt.getTime());
}

/** A colour as the site needs it: 6-digit hex, else the fallback. */
export function hex(value: string, fallback: string): string {
  return HEX.test(value) ? value.toLowerCase() : fallback;
}

export function buildSiteData(input: {
  settings: SettingsRow;
  projects: ProjectRow[];
  skills: SkillRow[];
  experience: ExperienceRow[];
  developerTools: ToolRow[];
}): SiteData {
  return {
    settings: siteSettings(input.settings),
    projects: sorted(
      // A project without an image can't be shown: the site renders it as <img>.
      input.projects.filter((p) => p.published && p.imageUrl),
      (p) => p.order,
    ).map((p) => ({
      _id: p.id,
      title: p.title,
      desc: p.desc,
      tags: p.tags,
      accent: hex(p.accent, '#818cf8'),
      gradientFrom: hex(p.gradientFrom, '#4f46e5'),
      gradientTo: hex(p.gradientTo, '#0ea5e9'),
      imageUrl: p.imageUrl ?? '',
      liveUrl: p.liveUrl,
      githubUrl: p.githubUrl,
      domain: p.domain,
    })),
    developerTools: sorted(
      input.developerTools.filter((t) => t.published),
      (t) => t.sortOrder,
    ).map((t) => ({
      _id: t.id,
      title: t.title,
      slug: t.slug,
      shortDescription: t.shortDescription,
      fullDescription: t.fullDescription,
      domain: t.domain,
      techStacks: t.techStacks,
      accent: hex(t.accent, '#818cf8'),
      gradientFrom: hex(t.gradientFrom, '#4f46e5'),
      gradientTo: hex(t.gradientTo, '#0ea5e9'),
      githubUrl: t.githubUrl,
      npmUrl: t.npmUrl,
      docsUrl: t.docsUrl,
      demoUrl: t.demoUrl,
      installCommand: t.installCommand,
      packageName: t.packageName,
      version: t.version,
      featured: t.featured,
      published: t.published,
      sortOrder: t.sortOrder,
    })),
    skills: sorted(
      input.skills.filter((s) => s.published),
      (s) => s.order,
    ).map((s) => ({ _id: s.id, cat: s.cat, items: s.items })),
    experience: sorted(
      input.experience.filter((e) => e.published),
      (e) => e.order,
    ).map((e) => ({
      _id: e.id,
      title: e.title,
      company: e.company,
      period: e.period,
      bullets: e.bullets,
    })),
  };
}

/** A developer tool's slug, as the old admin made it. */
export function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export const HANDLE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
