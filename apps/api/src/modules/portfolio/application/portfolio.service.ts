import { Inject, Injectable, Logger } from '@nestjs/common';

import type { AppConfig } from '@offerpath/config';
import type { Portfolio } from '@offerpath/database';

import { Problems } from '../../../common/http/problem-details.js';
import { decryptSecret, encryptSecret, lastFour } from '../../../common/secrets/secret-box.js';
import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { HubService } from '../../hub/application/hub.service.js';
import { PushService } from '../../sync/application/push.service.js';
import {
  HANDLE,
  buildSiteData,
  siteSettings,
  slugify,
  type SiteData,
  type SiteSettings,
} from '../domain/site.js';
import {
  CloudinaryClient,
  CloudinaryError,
  type CloudinaryAccount,
} from '../infrastructure/cloudinary.js';

export type ItemKind = 'projects' | 'skills' | 'experience' | 'developer-tools';

export type Source = { collection: string; id: string } | null;

export interface PortfolioView {
  handle: string;
  settings: SiteSettings;
  cloudinary: { configured: boolean; cloudName: string | null; apiKeyLast4: string | null };
  publicUrl: string;
  counts: {
    projects: number;
    drafts: number;
    skills: number;
    experience: number;
    developerTools: number;
    unreadMessages: number;
  };
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

export type SettingsInput = Partial<Omit<SiteSettings, 'socials'>> & {
  socials?: Partial<SiteSettings['socials']>;
};
export type ItemInput = Record<string, unknown>;

export type ItemRow = Row;

type Row = Record<string, unknown> & {
  id: string;
  portfolioId: string;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** The parts of a Prisma delegate the item routes use, shared by the four kinds. */
interface Delegate {
  findMany(args: unknown): Promise<Row[]>;
  findFirst(args: unknown): Promise<Row | null>;
  create(args: unknown): Promise<Row>;
  update(args: unknown): Promise<Row>;
  delete(args: unknown): Promise<Row>;
  aggregate(args: unknown): Promise<{ _max: Record<string, number | null> }>;
}

/** Per kind: its order column, and the fields that follow the profile item. */
const KINDS: Record<ItemKind, { order: 'order' | 'sortOrder'; text: string[] }> = {
  projects: { order: 'order', text: ['title', 'desc', 'tags'] },
  skills: { order: 'order', text: ['cat', 'items'] },
  experience: { order: 'order', text: ['title', 'company', 'period', 'bullets'] },
  'developer-tools': { order: 'sortOrder', text: [] },
};

const CONTACT_LIMIT = 5;
const CONTACT_WINDOW_MS = 60 * 60 * 1000;
const SITE_TTL_MS = 10 * 60 * 1000;
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * A user's portfolio (docs/portfolio.md): its content, edited in Offerpath,
 * and the public site data any portfolio site reads. The public response is
 * cached per handle and dropped on every change, so visitors never wait on
 * the database (Neon's free tier may be asleep).
 */
@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);
  private readonly siteCache = new Map<string, { data: SiteData; at: number }>();
  private readonly contactHits = new Map<string, number[]>();
  private readonly cloudinary: CloudinaryClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: HubService,
    private readonly push: PushService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.cloudinary = new CloudinaryClient();
  }

  // -- The portfolio ------------------------------------------------------------

  async view(userId: string): Promise<PortfolioView> {
    return this.toView(await this.mine(userId));
  }

  async create(userId: string, handle: string): Promise<PortfolioView> {
    if (await this.prisma.portfolio.findUnique({ where: { userId } })) {
      throw Problems.conflict('You already have a portfolio.');
    }
    await this.assertHandleFree(handle);
    const portfolio = await this.prisma.portfolio.create({ data: { userId, handle } });
    return this.toView(portfolio);
  }

  async update(
    userId: string,
    input: { handle?: string; settings?: SettingsInput },
  ): Promise<PortfolioView> {
    const portfolio = await this.mine(userId);
    if (input.handle && input.handle !== portfolio.handle)
      await this.assertHandleFree(input.handle);
    const s = input.settings ?? {};
    const updated = await this.prisma.portfolio.update({
      where: { id: portfolio.id },
      data: {
        ...(input.handle ? { handle: input.handle } : {}),
        ...(s.heroName !== undefined ? { heroName: s.heroName } : {}),
        ...(s.heroEyebrow !== undefined ? { heroEyebrow: s.heroEyebrow } : {}),
        ...(s.roles !== undefined ? { roles: s.roles } : {}),
        ...(s.heroBio !== undefined ? { heroBio: s.heroBio } : {}),
        ...(s.resumeUrl !== undefined ? { resumeUrl: s.resumeUrl } : {}),
        ...(s.aboutHeadline !== undefined ? { aboutHeadline: s.aboutHeadline } : {}),
        ...(s.aboutParagraphs !== undefined ? { aboutParagraphs: s.aboutParagraphs } : {}),
        ...(s.socials?.github !== undefined ? { socialGithub: s.socials.github } : {}),
        ...(s.socials?.linkedin !== undefined ? { socialLinkedin: s.socials.linkedin } : {}),
        ...(s.socials?.twitter !== undefined ? { socialTwitter: s.socials.twitter } : {}),
        ...(s.socials?.email !== undefined ? { socialEmail: s.socials.email } : {}),
      },
    });
    this.changed(portfolio);
    this.changed(updated);
    return this.toView(updated);
  }

  async saveCloudinary(userId: string, account: CloudinaryAccount): Promise<PortfolioView> {
    const portfolio = await this.mine(userId);
    try {
      await this.cloudinary.check(account);
    } catch (error) {
      throw Problems.validation({
        cloudinary: [describe(error, 'Cloudinary refused these credentials.')],
      });
    }
    const updated = await this.prisma.portfolio.update({
      where: { id: portfolio.id },
      data: {
        cloudinaryCloud: account.cloudName,
        cloudinaryKey: account.apiKey,
        cloudinarySecret: encryptSecret(account.apiSecret, this.passphrase()),
      },
    });
    return this.toView(updated);
  }

  async removeCloudinary(userId: string): Promise<PortfolioView> {
    const portfolio = await this.mine(userId);
    const updated = await this.prisma.portfolio.update({
      where: { id: portfolio.id },
      data: { cloudinaryCloud: null, cloudinaryKey: null, cloudinarySecret: null },
    });
    return this.toView(updated);
  }

  async upload(userId: string, fileName: string, contentBase64: string): Promise<{ url: string }> {
    const portfolio = await this.mine(userId);
    const account = this.account(portfolio);
    if (!account) {
      throw Problems.validation({ cloudinary: ['Connect your Cloudinary account first.'] });
    }
    const mime = IMAGE_TYPES[fileName.toLowerCase().split('.').pop() ?? ''];
    if (!mime) throw Problems.validation({ fileName: ['Upload a PNG, JPG, WebP or GIF image.'] });
    const bytes = Buffer.from(contentBase64, 'base64');
    if (bytes.length === 0) throw Problems.validation({ contentBase64: ['The file is empty.'] });
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw Problems.validation({ contentBase64: ['An image can be at most 8 MB.'] });
    }
    try {
      return { url: await this.cloudinary.upload(account, { bytes, mime }, 'portfolio') };
    } catch (error) {
      throw Problems.aiUnavailable(describe(error, 'Cloudinary could not take the image.'));
    }
  }

  // -- Items: projects, skills, experience, developer tools ---------------------------

  async list(userId: string, kind: ItemKind): Promise<Record<string, unknown>[]> {
    const portfolio = await this.mine(userId);
    const order = KINDS[kind].order;
    const rows = await this.delegate(kind).findMany({
      where: { portfolioId: portfolio.id },
      orderBy: [{ [order]: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => toItem(r));
  }

  async createItem(
    userId: string,
    kind: ItemKind,
    input: ItemInput,
  ): Promise<Record<string, unknown>> {
    const portfolio = await this.mine(userId);
    const order = KINDS[kind].order;
    const max = await this.delegate(kind).aggregate({
      where: { portfolioId: portfolio.id },
      _max: { [order]: true },
    });
    const data: ItemInput = { ...input, portfolioId: portfolio.id };
    if (data[order] === undefined) data[order] = (max._max[order] ?? -1) + 1;
    if (kind === 'developer-tools')
      data.slug = await this.freeSlug(portfolio.id, String(input.title));
    if (kind === 'projects' && data.published === true && !data.imageUrl) {
      throw Problems.validation({ published: ['Add an image before publishing a project.'] });
    }
    const row = await this.delegate(kind).create({ data });
    this.changed(portfolio);
    return toItem(row);
  }

  async updateItem(
    userId: string,
    kind: ItemKind,
    id: string,
    input: ItemInput,
  ): Promise<Record<string, unknown>> {
    const portfolio = await this.mine(userId);
    const current = await this.item(kind, portfolio.id, id);
    const data: ItemInput = { ...input };

    // Editing the text a linked item takes from the profile unlinks it.
    if (KINDS[kind].text.some((field) => field in input) && input.followsSource !== true) {
      data.followsSource = false;
    }
    if (
      kind === 'developer-tools' &&
      typeof input.title === 'string' &&
      input.title !== current.title
    ) {
      data.slug = await this.freeSlug(portfolio.id, input.title, id);
    }
    if (kind === 'projects') {
      const imageUrl = 'imageUrl' in input ? input.imageUrl : current.imageUrl;
      const published = 'published' in input ? input.published : current.published;
      if (published === true && !imageUrl) {
        throw Problems.validation({ published: ['Add an image before publishing a project.'] });
      }
    }
    let row = await this.delegate(kind).update({ where: { id }, data });
    if (input.followsSource === true && row.sourceCollection && row.sourceId) {
      row = (await this.refreshFromProfile(userId, kind, row)) ?? row;
    }
    this.changed(portfolio);
    return toItem(row);
  }

  async removeItem(userId: string, kind: ItemKind, id: string): Promise<void> {
    const portfolio = await this.mine(userId);
    const row = await this.item(kind, portfolio.id, id);
    await this.delegate(kind).delete({ where: { id } });
    // A profile item deleted from the portfolio isn't brought back.
    if (row.sourceCollection && row.sourceId) {
      await this.prisma.portfolio.update({
        where: { id: portfolio.id },
        data: {
          dismissedSources: { push: `${String(row.sourceCollection)}:${String(row.sourceId)}` },
        },
      });
    }
    this.changed(portfolio);
  }

  async reorder(userId: string, kind: ItemKind, ids: string[]): Promise<Record<string, unknown>[]> {
    const portfolio = await this.mine(userId);
    const order = KINDS[kind].order;
    const rows = await this.delegate(kind).findMany({ where: { portfolioId: portfolio.id } });
    const known = new Set(rows.map((r) => r.id));
    if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
      throw Problems.validation({ ids: ['Send every item of this list, each once.'] });
    }
    // The delegates' updates are Prisma promises, which a transaction batches.
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.delegate(kind).update({ where: { id }, data: { [order]: index } }),
      ) as never,
    );
    this.changed(portfolio);
    return this.list(userId, kind);
  }

  // -- Messages -----------------------------------------------------------------------

  async messages(userId: string): Promise<MessageItem[]> {
    const portfolio = await this.mine(userId);
    const rows = await this.prisma.portfolioMessage.findMany({
      where: { portfolioId: portfolio.id },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toMessage);
  }

  async markMessage(userId: string, id: string, read: boolean): Promise<MessageItem> {
    const portfolio = await this.mine(userId);
    const found = await this.prisma.portfolioMessage.findFirst({
      where: { id, portfolioId: portfolio.id },
    });
    if (!found) throw Problems.notFound('Message');
    return toMessage(await this.prisma.portfolioMessage.update({ where: { id }, data: { read } }));
  }

  async removeMessage(userId: string, id: string): Promise<void> {
    const portfolio = await this.mine(userId);
    const { count } = await this.prisma.portfolioMessage.deleteMany({
      where: { id, portfolioId: portfolio.id },
    });
    if (count === 0) throw Problems.notFound('Message');
  }

  // -- Public ---------------------------------------------------------------------------

  /** What a portfolio site reads; null for an unknown handle. */
  async site(handle: string): Promise<SiteData | null> {
    const cached = this.siteCache.get(handle);
    if (cached && Date.now() - cached.at < SITE_TTL_MS) return cached.data;

    const portfolio = await this.prisma.portfolio.findUnique({
      where: { handle },
      include: { projects: true, skillGroups: true, experience: true, developerTools: true },
    });
    if (!portfolio) return null;
    const data = buildSiteData({
      settings: portfolio,
      projects: portfolio.projects,
      skills: portfolio.skillGroups,
      experience: portfolio.experience,
      developerTools: portfolio.developerTools,
    });
    this.siteCache.set(handle, { data, at: Date.now() });
    return data;
  }

  /**
   * A message from a portfolio site's contact form. Saved, then the owner's
   * phones hear about it. Limited per visitor IP; a filled honeypot is
   * thanked and dropped.
   */
  async contact(
    handle: string,
    visitor: string,
    input: { name: string; email: string; message: string; website?: string },
  ): Promise<'ok' | 'not-found' | 'limited'> {
    const portfolio = await this.prisma.portfolio.findUnique({ where: { handle } });
    if (!portfolio) return 'not-found';
    if (input.website?.trim()) return 'ok';

    const key = `${handle}|${visitor}`;
    const now = Date.now();
    const hits = (this.contactHits.get(key) ?? []).filter((t) => now - t < CONTACT_WINDOW_MS);
    if (hits.length >= CONTACT_LIMIT) return 'limited';
    hits.push(now);
    this.contactHits.set(key, hits);

    const message = await this.prisma.portfolioMessage.create({
      data: {
        portfolioId: portfolio.id,
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        message: input.message.trim(),
      },
    });
    const payload = {
      id: `portfolio-message-${message.id}`,
      level: 'info',
      kind: 'PORTFOLIO_MESSAGE',
      title: `New message from ${message.name}`,
      body: message.message.slice(0, 160),
      linkPage: 'portfolio-messages',
      linkId: message.id,
      createdAt: message.createdAt.toISOString(),
    };
    this.hub.pushToMobiles(portfolio.userId, 'notification', payload);
    void this.push.sendToUser(portfolio.userId, {
      title: payload.title,
      body: payload.body,
      data: { ...payload },
    });
    return 'ok';
  }

  // -- Shared with the profile import -------------------------------------------------------

  /**
   * A portfolio changed: its cached public response goes, and the owner's
   * phones are told to refresh their portfolio screens.
   */
  changed(portfolio: Pick<Portfolio, 'handle' | 'userId'>): void {
    this.siteCache.delete(portfolio.handle);
    this.hub.pushToMobiles(portfolio.userId, 'changed', { collections: ['portfolio'] });
  }

  delegate(kind: ItemKind): Delegate {
    const delegates: Record<ItemKind, unknown> = {
      projects: this.prisma.portfolioProject,
      skills: this.prisma.portfolioSkillGroup,
      experience: this.prisma.portfolioExperience,
      'developer-tools': this.prisma.portfolioDeveloperTool,
    };
    return delegates[kind] as Delegate;
  }

  /** Set by the profile import: refreshes a re-linked item from its profile item. */
  refreshFromProfile: (userId: string, kind: ItemKind, row: Row) => Promise<Row | null> =
    async () => null;

  // -- Internals ------------------------------------------------------------------------------

  async mine(userId: string): Promise<Portfolio> {
    const portfolio = await this.prisma.portfolio.findUnique({ where: { userId } });
    if (!portfolio) throw Problems.notFound('Portfolio');
    return portfolio;
  }

  private async item(kind: ItemKind, portfolioId: string, id: string): Promise<Row> {
    const row = await this.delegate(kind).findFirst({ where: { id, portfolioId } });
    if (!row) throw Problems.notFound('Item');
    return row;
  }

  private async assertHandleFree(handle: string): Promise<void> {
    if (!HANDLE.test(handle)) {
      throw Problems.validation({
        handle: [
          '3 to 40 lowercase letters, digits or dashes, not starting or ending with a dash.',
        ],
      });
    }
    if (await this.prisma.portfolio.findUnique({ where: { handle } })) {
      throw Problems.conflict(`The handle "${handle}" is taken.`);
    }
  }

  /** A slug from the title, made unique within the portfolio. */
  private async freeSlug(portfolioId: string, title: string, exceptId?: string): Promise<string> {
    const base = slugify(title) || 'tool';
    for (let n = 1; ; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      const taken = await this.prisma.portfolioDeveloperTool.findFirst({
        where: { portfolioId, slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
        select: { id: true },
      });
      if (!taken) return slug;
    }
  }

  private passphrase(): string {
    const key = this.config.env.ENCRYPTION_KEY;
    if (key.length < 16) {
      throw Problems.validation({ cloudinary: ['This server cannot store secrets yet.'] });
    }
    return key;
  }

  private account(portfolio: Portfolio): CloudinaryAccount | null {
    if (!portfolio.cloudinaryCloud || !portfolio.cloudinaryKey || !portfolio.cloudinarySecret) {
      return null;
    }
    try {
      return {
        cloudName: portfolio.cloudinaryCloud,
        apiKey: portfolio.cloudinaryKey,
        apiSecret: decryptSecret(portfolio.cloudinarySecret, this.passphrase()),
      };
    } catch (error) {
      this.logger.warn(`Cloudinary secret of ${portfolio.id} can't be decrypted: ${String(error)}`);
      return null;
    }
  }

  private async toView(portfolio: Portfolio): Promise<PortfolioView> {
    const where = { portfolioId: portfolio.id };
    const [projects, drafts, skills, experience, developerTools, unreadMessages] =
      await Promise.all([
        this.prisma.portfolioProject.count({ where }),
        Promise.all([
          this.prisma.portfolioProject.count({ where: { ...where, published: false } }),
          this.prisma.portfolioSkillGroup.count({ where: { ...where, published: false } }),
          this.prisma.portfolioExperience.count({ where: { ...where, published: false } }),
          this.prisma.portfolioDeveloperTool.count({ where: { ...where, published: false } }),
        ]).then((n) => n.reduce((a, b) => a + b, 0)),
        this.prisma.portfolioSkillGroup.count({ where }),
        this.prisma.portfolioExperience.count({ where }),
        this.prisma.portfolioDeveloperTool.count({ where }),
        this.prisma.portfolioMessage.count({ where: { ...where, read: false } }),
      ]);
    return {
      handle: portfolio.handle,
      settings: siteSettings(portfolio),
      cloudinary: {
        configured: Boolean(portfolio.cloudinarySecret),
        cloudName: portfolio.cloudinaryCloud,
        apiKeyLast4: portfolio.cloudinaryKey ? lastFour(portfolio.cloudinaryKey) : null,
      },
      publicUrl: `/${this.config.env.API_GLOBAL_PREFIX}/v1/public/portfolio/${portfolio.handle}/site`,
      counts: { projects, drafts, skills, experience, developerTools, unreadMessages },
      createdAt: portfolio.createdAt.toISOString(),
      updatedAt: portfolio.updatedAt.toISOString(),
    };
  }
}

/** A row as the private API shows it: dates as ISO, the source as one object. */
function toItem(row: Row): Record<string, unknown> {
  const {
    portfolioId: _portfolio,
    sourceCollection,
    sourceId,
    createdAt,
    updatedAt,
    ...rest
  } = row;
  const item: Record<string, unknown> = {
    ...rest,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
  if ('followsSource' in row) {
    item.source =
      sourceCollection && sourceId ? { collection: sourceCollection, id: sourceId } : null;
  }
  return item;
}

function toMessage(m: {
  id: string;
  name: string;
  email: string;
  message: string;
  read: boolean;
  createdAt: Date;
}): MessageItem {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    message: m.message,
    read: m.read,
    createdAt: m.createdAt.toISOString(),
  };
}

function describe(error: unknown, fallback: string): string {
  return error instanceof CloudinaryError ? error.message : fallback;
}
