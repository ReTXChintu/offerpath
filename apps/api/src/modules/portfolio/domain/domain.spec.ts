import {
  experienceFromProfile,
  monthYear,
  paletteFor,
  periodOf,
  projectFromProfile,
  skillGroupsFromProfile,
} from './from-profile.js';
import { HANDLE, buildSiteData, slugify, type ProjectRow, type SettingsRow } from './site.js';

const settings: SettingsRow = {
  heroName: 'Ada',
  heroEyebrow: '',
  roles: [],
  heroBio: '',
  resumeUrl: '',
  aboutHeadline: '',
  aboutParagraphs: ['  One.  ', ''],
  socialGithub: 'https://github.com/ada',
  socialLinkedin: '',
  socialTwitter: '',
  socialEmail: '',
};

const day = (n: number) => new Date(Date.UTC(2026, 0, n));
const project = (over: Partial<ProjectRow>): ProjectRow => ({
  id: 'p',
  title: 'T',
  desc: 'A description',
  tags: [],
  accent: '#818CF8',
  gradientFrom: '#4f46e5',
  gradientTo: '#0ea5e9',
  imageUrl: 'https://img/x.png',
  liveUrl: '',
  githubUrl: '',
  domain: '',
  order: 0,
  published: true,
  createdAt: day(1),
  ...over,
});

describe('the public site data', () => {
  it('fills the settings defaults the site relies on', () => {
    const data = buildSiteData({
      settings,
      projects: [],
      skills: [],
      experience: [],
      developerTools: [],
    });
    expect(data.settings).toEqual({
      heroName: 'Ada',
      heroEyebrow: 'Developer',
      roles: ['Developer'],
      heroBio: '',
      resumeUrl: '#',
      aboutHeadline: '',
      aboutParagraphs: ['One.'],
      socials: { github: 'https://github.com/ada', linkedin: '#', twitter: '#', email: '#' },
    });
  });

  it('shows only published projects with an image, by order then newest', () => {
    const data = buildSiteData({
      settings,
      projects: [
        project({ id: 'old', order: 1, createdAt: day(1) }),
        project({ id: 'new', order: 1, createdAt: day(5) }),
        project({ id: 'first', order: 0 }),
        project({ id: 'draft', published: false }),
        project({ id: 'no-image', imageUrl: null }),
        project({ id: 'bad-colour', order: 9, accent: 'red' }),
      ],
      skills: [],
      experience: [],
      developerTools: [],
    });
    expect(data.projects.map((p) => p._id)).toEqual(['first', 'new', 'old', 'bad-colour']);
    expect(data.projects[0]!.accent).toBe('#818cf8');
    expect(data.projects[3]!.accent).toBe('#818cf8');
    expect(data.projects[0]).toEqual(
      expect.objectContaining({ liveUrl: '', githubUrl: '', imageUrl: 'https://img/x.png' }),
    );
    expect(Object.keys(data.projects[0]!)).not.toContain('published');
  });

  it('makes slugs and checks handles like the old admin', () => {
    expect(slugify('  Mongoose CRUD Generator! ')).toBe('mongoose-crud-generator');
    expect(HANDLE.test('portfolio')).toBe(true);
    expect(HANDLE.test('my-site-2')).toBe(true);
    expect(HANDLE.test('ab')).toBe(false);
    expect(HANDLE.test('Bad_Handle')).toBe(false);
    expect(HANDLE.test('-dash')).toBe(false);
  });
});

describe('drafts from the profile', () => {
  it('maps a project, putting a GitHub url where it belongs', () => {
    expect(
      projectFromProfile({
        name: 'Ledger',
        description: '',
        achievements: ['Handles 2M rows a day'],
        technologies: ['PostgreSQL', ' Go '],
        url: 'https://github.com/ada/ledger',
      }),
    ).toEqual({
      title: 'Ledger',
      desc: 'Handles 2M rows a day',
      tags: ['PostgreSQL', 'Go'],
      liveUrl: '',
      githubUrl: 'https://github.com/ada/ledger',
    });
    expect(projectFromProfile({ name: 'Site', url: 'https://ada.dev' })).toMatchObject({
      liveUrl: 'https://ada.dev',
      githubUrl: '',
    });
    expect(projectFromProfile({ name: '  ' })).toBeNull();
  });

  it('maps an experience with a readable period', () => {
    expect(monthYear('2021-03')).toBe('Mar 2021');
    expect(monthYear('2021')).toBe('2021');
    expect(periodOf('2021-03', null)).toBe('Mar 2021 – Present');
    expect(
      experienceFromProfile({
        role: 'Senior engineer',
        company: 'Paysafe',
        startDate: '2021-01-10',
        endDate: '2024-06',
        description: 'Owned the ledger. Led four people.',
        achievements: [],
      }),
    ).toEqual({
      title: 'Senior engineer',
      company: 'Paysafe',
      period: 'Jan 2021 – Jun 2024',
      bullets: ['Owned the ledger.', 'Led four people.'],
    });
  });

  it('turns each non-empty skill group into a group', () => {
    expect(
      skillGroupsFromProfile({ skills: { frontend: ['React'], backend: [], devops: ['Docker'] } }),
    ).toEqual([
      { sourceId: 'skills:frontend', cat: 'Frontend', items: ['React'] },
      { sourceId: 'skills:devops', cat: 'DevOps', items: ['Docker'] },
    ]);
  });

  it('gives each project a stable colour', () => {
    expect(paletteFor('a')).toEqual(paletteFor('a'));
  });
});
