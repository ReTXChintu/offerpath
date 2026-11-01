import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { SyncService } from '../../sync/application/sync.service.js';
import {
  experienceFromProfile,
  paletteFor,
  projectFromProfile,
  skillGroupsFromProfile,
} from '../domain/from-profile.js';

import { PortfolioService, type ItemKind, type ItemRow } from './portfolio.service.js';

type Doc = Record<string, unknown>;
type Linked = {
  id: string;
  sourceId: string | null;
  followsSource: boolean;
} & Record<string, unknown>;

const PROFILE_COLLECTIONS = new Set(['projects', 'experiences', 'candidate_profiles']);
const DEBOUNCE_MS = 3_000;

/**
 * The profile feeds the portfolio (docs/portfolio.md, "From the profile"):
 * new projects, experiences and skill groups arrive as drafts; linked items
 * that still follow their source get its text again. Runs a few seconds
 * after the desktop syncs any of those, on `import-profile`, and when a
 * portfolio is created.
 */
@Injectable()
export class ProfileImportService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ProfileImportService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
    private readonly portfolios: PortfolioService,
  ) {}

  onApplicationBootstrap(): void {
    this.unsubscribe = this.sync.onChange((userId, collection) => {
      if (PROFILE_COLLECTIONS.has(collection)) this.schedule(userId);
    });
    this.portfolios.refreshFromProfile = async (userId, kind, row) =>
      (await this.refresh(userId, kind, row as unknown as Linked)) as unknown as ItemRow | null;
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    for (const timer of this.timers.values()) clearTimeout(timer);
  }

  private schedule(userId: string): void {
    clearTimeout(this.timers.get(userId));
    this.timers.set(
      userId,
      setTimeout(() => {
        this.timers.delete(userId);
        this.import(userId).catch((error: unknown) =>
          this.logger.warn(`Profile import for ${userId} failed: ${String(error)}`),
        );
      }, DEBOUNCE_MS),
    );
  }

  async import(userId: string): Promise<{ created: number; updated: number }> {
    const portfolio = await this.prisma.portfolio.findUnique({ where: { userId } });
    if (!portfolio) return { created: 0, updated: 0 };
    const docs = await this.profileDocs(userId);
    const dismissed = new Set(portfolio.dismissedSources);
    let created = 0;
    let updated = 0;

    const plan: {
      kind: ItemKind;
      collection: string;
      drafts: { sourceId: string; data: Record<string, unknown> }[];
    }[] = [
      {
        kind: 'projects',
        collection: 'projects',
        drafts: docs.projects.flatMap(({ id, doc }) => {
          const draft = projectFromProfile(doc);
          return draft ? [{ sourceId: id, data: { ...draft } }] : [];
        }),
      },
      {
        kind: 'experience',
        collection: 'experiences',
        drafts: docs.experiences.flatMap(({ id, doc }) => {
          const draft = experienceFromProfile(doc);
          return draft ? [{ sourceId: id, data: { ...draft } }] : [];
        }),
      },
      {
        kind: 'skills',
        collection: 'skills',
        drafts: docs.profile
          ? skillGroupsFromProfile(docs.profile).map((g) => ({
              sourceId: g.sourceId.slice('skills:'.length),
              data: { cat: g.cat, items: g.items },
            }))
          : [],
      },
    ];

    for (const { kind, collection, drafts } of plan) {
      const delegate = this.portfolios.delegate(kind);
      const linked = (await delegate.findMany({
        where: { portfolioId: portfolio.id, sourceCollection: collection },
      })) as unknown as Linked[];
      const bySource = new Map(linked.map((row) => [row.sourceId, row]));
      const max = await delegate.aggregate({
        where: { portfolioId: portfolio.id },
        _max: { order: true },
      });
      let nextOrder = (max._max.order ?? -1) + 1;

      for (const { sourceId, data } of drafts) {
        const row = bySource.get(sourceId);
        if (row) {
          if (row.followsSource && differs(row, data)) {
            await delegate.update({ where: { id: row.id }, data });
            // At once, so the public site never serves the old text meanwhile.
            this.portfolios.changed(portfolio);
            updated++;
          }
          continue;
        }
        if (dismissed.has(`${collection}:${sourceId}`)) continue;
        await delegate.create({
          data: {
            ...data,
            ...(kind === 'projects' ? paletteFor(sourceId) : {}),
            portfolioId: portfolio.id,
            order: nextOrder++,
            published: false,
            sourceCollection: collection,
            sourceId,
            followsSource: true,
          },
        });
        this.portfolios.changed(portfolio);
        created++;
      }
    }

    if (created > 0 || updated > 0) {
      this.logger.log(`Portfolio ${portfolio.handle}: ${created} drafts, ${updated} refreshed`);
    }
    return { created, updated };
  }

  /** A re-linked item takes its source's text again. */
  private async refresh(userId: string, kind: ItemKind, row: Linked): Promise<Linked | null> {
    const docs = await this.profileDocs(userId);
    let data: Record<string, unknown> | null = null;
    if (kind === 'projects') {
      const doc = docs.projects.find((d) => d.id === row.sourceId)?.doc;
      data = doc ? { ...projectFromProfile(doc) } : null;
    } else if (kind === 'experience') {
      const doc = docs.experiences.find((d) => d.id === row.sourceId)?.doc;
      data = doc ? { ...experienceFromProfile(doc) } : null;
    } else if (kind === 'skills' && docs.profile) {
      const group = skillGroupsFromProfile(docs.profile).find(
        (g) => g.sourceId === `skills:${row.sourceId}`,
      );
      data = group ? { cat: group.cat, items: group.items } : null;
    }
    if (!data || Object.keys(data).length === 0) return null;
    return (await this.portfolios
      .delegate(kind)
      .update({ where: { id: row.id }, data })) as unknown as Linked;
  }

  private async profileDocs(userId: string) {
    const rows = await this.prisma.syncDocument.findMany({
      where: { userId, deletedAt: null, collection: { in: [...PROFILE_COLLECTIONS] } },
      orderBy: { updatedAt: 'desc' },
    });
    const of = (collection: string) =>
      rows.filter((r) => r.collection === collection).map((r) => ({ id: r.id, doc: r.doc as Doc }));
    return {
      projects: of('projects'),
      experiences: of('experiences'),
      profile: of('candidate_profiles')[0]?.doc ?? null,
    };
  }
}

function differs(row: Record<string, unknown>, data: Record<string, unknown>): boolean {
  return Object.entries(data).some(
    ([key, value]) => JSON.stringify(row[key]) !== JSON.stringify(value),
  );
}
