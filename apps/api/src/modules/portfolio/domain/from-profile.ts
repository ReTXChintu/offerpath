/**
 * Profile → portfolio drafts (docs/portfolio.md, "From the profile"): the
 * desktop's synced candidate profile, experiences and projects, as portfolio
 * items. Pure; the documents are the Rust core's camelCase JSON.
 */

type Doc = Record<string, unknown>;

export interface DraftProject {
  title: string;
  desc: string;
  tags: string[];
  liveUrl: string;
  githubUrl: string;
}

export interface DraftExperience {
  title: string;
  company: string;
  period: string;
  bullets: string[];
}

export interface DraftSkillGroup {
  /** "skills:<group>" */
  sourceId: string;
  cat: string;
  items: string[];
}

/** Gradients for new projects, picked by a stable hash so each looks its own. */
export const PALETTE: readonly { accent: string; gradientFrom: string; gradientTo: string }[] = [
  { accent: '#818cf8', gradientFrom: '#4f46e5', gradientTo: '#0ea5e9' },
  { accent: '#a78bfa', gradientFrom: '#8b5cf6', gradientTo: '#4f46e5' },
  { accent: '#22d3ee', gradientFrom: '#22d3ee', gradientTo: '#0d9488' },
  { accent: '#f472b6', gradientFrom: '#ec4899', gradientTo: '#8b5cf6' },
  { accent: '#fbbf24', gradientFrom: '#f59e0b', gradientTo: '#ef4444' },
  { accent: '#34d399', gradientFrom: '#10b981', gradientTo: '#0ea5e9' },
];

export function paletteFor(key: string) {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

export function projectFromProfile(doc: Doc): DraftProject | null {
  const title = str(doc.name);
  if (!title) return null;
  const achievements = strings(doc.achievements);
  const url = str(doc.url);
  const isGithub = /^https?:\/\/(www\.)?github\.com\//i.test(url);
  return {
    title,
    desc: str(doc.description) || achievements[0] || title,
    tags: strings(doc.technologies),
    liveUrl: url && !isGithub ? url : '',
    githubUrl: isGithub ? url : '',
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2021-03" / "2021-03-15" / "2021" → "Mar 2021" / "2021"; anything else as written. */
export function monthYear(value: string): string {
  const m = value.trim().match(/^(\d{4})(?:-(\d{1,2}))?/);
  if (!m) return value.trim();
  const month = m[2] ? MONTHS[Number(m[2]) - 1] : undefined;
  return month ? `${month} ${m[1]}` : m[1]!;
}

export function periodOf(start: string, end: string | null): string {
  const from = start ? monthYear(start) : '';
  const to = end ? monthYear(end) : 'Present';
  return from ? `${from} – ${to}` : to;
}

export function experienceFromProfile(doc: Doc): DraftExperience | null {
  const title = str(doc.role);
  const company = str(doc.company);
  if (!title || !company) return null;
  const achievements = strings(doc.achievements);
  const description = str(doc.description);
  return {
    title,
    company,
    period: periodOf(str(doc.startDate), str(doc.endDate) || null),
    bullets:
      achievements.length > 0
        ? achievements
        : description
            .split(/(?<=[.!?])\s+/)
            .map((s) => s.trim())
            .filter(Boolean),
  };
}

const SKILL_NAMES: Record<string, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  database: 'Database',
  devops: 'DevOps',
  cloud: 'Cloud',
  testing: 'Testing',
  other: 'Other',
};

export function skillGroupsFromProfile(profile: Doc): DraftSkillGroup[] {
  const skills = (profile.skills ?? {}) as Doc;
  return Object.keys(SKILL_NAMES)
    .map((group) => ({
      sourceId: `skills:${group}`,
      cat: SKILL_NAMES[group]!,
      items: strings(skills[group]),
    }))
    .filter((g) => g.items.length > 0);
}
