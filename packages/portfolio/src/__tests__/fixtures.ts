import type {
  DeveloperToolItem,
  ExperienceItem,
  MessageItem,
  PortfolioView,
  ProjectItem,
  SkillGroupItem,
} from '../types';

const AT = '2026-10-20T10:00:00.000Z';

export const VIEW: PortfolioView = {
  handle: 'biswajit',
  settings: {
    heroName: 'Biswajit Panda',
    heroEyebrow: 'Full-stack developer',
    roles: ['Full-stack developer', 'Mobile developer'],
    heroBio: 'I build products.',
    resumeUrl: '',
    aboutHeadline: 'About me',
    aboutParagraphs: ['First paragraph.', 'Second paragraph.'],
    socials: {
      github: 'https://github.com/me',
      linkedin: '',
      twitter: '',
      email: 'me@example.com',
    },
  },
  cloudinary: { configured: true, cloudName: 'demo', apiKeyLast4: '1234' },
  publicUrl: '/api/v1/public/portfolio/biswajit/site',
  counts: {
    projects: 3,
    drafts: 2,
    skills: 2,
    experience: 1,
    developerTools: 1,
    unreadMessages: 1,
  },
  createdAt: AT,
  updatedAt: AT,
};

export function project(over: Partial<ProjectItem> = {}): ProjectItem {
  return {
    id: 'p1',
    title: 'Offerpath',
    desc: 'Finds jobs and prepares you for interviews.',
    tags: ['React', 'NestJS'],
    accent: '#6366f1',
    gradientFrom: '#1e1b4b',
    gradientTo: '#4338ca',
    imageUrl: 'https://res.cloudinary.com/demo/offerpath.png',
    liveUrl: '',
    githubUrl: 'https://github.com/me/offerpath',
    domain: 'Careers',
    order: 0,
    published: true,
    source: null,
    followsSource: false,
    localPath: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

export function skillGroup(over: Partial<SkillGroupItem> = {}): SkillGroupItem {
  return {
    id: 's1',
    cat: 'Frontend',
    items: ['React', 'TypeScript'],
    order: 0,
    published: false,
    source: { collection: 'skills', id: 'skills:frontend' },
    followsSource: true,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

export function experience(over: Partial<ExperienceItem> = {}): ExperienceItem {
  return {
    id: 'e1',
    title: 'Senior engineer',
    company: 'iBoon',
    period: 'Jan 2023 – Present',
    bullets: ['Built things', 'Led things'],
    order: 0,
    published: true,
    source: null,
    followsSource: false,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

export function tool(over: Partial<DeveloperToolItem> = {}): DeveloperToolItem {
  return {
    id: 't1',
    title: 'Env guard',
    slug: 'env-guard',
    shortDescription: 'Checks your .env against a schema.',
    fullDescription: '',
    domain: 'DX',
    techStacks: ['Node.js'],
    accent: '#10b981',
    gradientFrom: '#064e3b',
    gradientTo: '#047857',
    githubUrl: '',
    npmUrl: '',
    docsUrl: '',
    demoUrl: '',
    installCommand: 'npm i env-guard',
    packageName: 'env-guard',
    version: '1.0.0',
    featured: false,
    published: false,
    sortOrder: 0,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

export function message(over: Partial<MessageItem> = {}): MessageItem {
  return {
    id: 'm1',
    name: 'Asha',
    email: 'asha@example.com',
    message: 'Hello, I would like to talk about a role.',
    read: false,
    createdAt: AT,
    ...over,
  };
}
