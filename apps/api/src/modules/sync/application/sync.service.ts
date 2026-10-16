import { Injectable } from '@nestjs/common';

import { type Prisma, parseTimestamp, stripNul } from '@offerpath/database';

import { Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { HubService } from '../../hub/application/hub.service.js';

import { PushService } from './push.service.js';

/**
 * Collections the desktop syncs. Mirrors `offerpath-core`'s `COLLECTIONS`
 * (from job-hunter-core's `domain/mod.rs`); keep the two in step. Local-only
 * collections (job-site profiles, the queue, ...) never reach the server.
 */
export const SYNCED_COLLECTIONS = [
  'users',
  'candidate_profiles',
  'experiences',
  'projects',
  'jobs',
  'job_analyses',
  'resumes',
  'cover_letters',
  'applications',
  'application_answers',
  'agent_runs',
  'agent_events',
  'settings',
  'notifications',
] as const;

export type SyncedCollection = (typeof SYNCED_COLLECTIONS)[number];

export type JsonDoc = Record<string, unknown>;

export function assertCollection(name: string): asserts name is SyncedCollection {
  if (!(SYNCED_COLLECTIONS as readonly string[]).includes(name)) {
    throw Problems.validation({ collection: [`unknown collection "${name}"`] });
  }
}

/**
 * The server side of the desktop's local-first store.
 *
 * The same three operations Job Hunter's backend had (upsert, delete, fetch
 * all), now on Postgres `sync_documents`, so the Rust sync layer is unchanged.
 * Each write tells the account's phones what changed, and a new notification
 * is pushed to them at once.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: HubService,
    private readonly push: PushService,
  ) {}

  async upsert(userId: string, collection: string, id: string, body: JsonDoc): Promise<void> {
    assertCollection(collection);
    const doc = stripNul({ ...body, id, userId }) as Prisma.InputJsonObject;
    const updatedAt =
      parseTimestamp(body.updatedAt) ?? parseTimestamp(body.createdAt) ?? new Date();

    await this.prisma.syncDocument.upsert({
      where: { userId_collection_id: { userId, collection, id } },
      create: { userId, collection, id, doc, updatedAt },
      update: { doc, updatedAt, deletedAt: null },
    });

    this.hub.pushToMobiles(userId, 'changed', { collections: [collection] });
    if (collection === 'notifications') this.announce(userId, body);
  }

  async delete(userId: string, collection: string, id: string): Promise<void> {
    assertCollection(collection);
    await this.prisma.syncDocument.updateMany({
      where: { userId, collection, id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    this.hub.pushToMobiles(userId, 'changed', { collections: [collection] });
  }

  async fetchAll(userId: string, collection: string): Promise<JsonDoc[]> {
    assertCollection(collection);
    const rows = await this.prisma.syncDocument.findMany({
      where: { userId, collection, deletedAt: null },
      orderBy: { updatedAt: 'asc' },
      select: { doc: true },
    });
    return rows.map((r) => r.doc as JsonDoc);
  }

  async fetchOne(
    userId: string,
    collection: SyncedCollection,
    id: string,
  ): Promise<JsonDoc | null> {
    const row = await this.prisma.syncDocument.findFirst({
      where: { userId, collection, id, deletedAt: null },
      select: { doc: true },
    });
    return (row?.doc as JsonDoc | undefined) ?? null;
  }

  /** Documents whose top-level `field` equals `value`. */
  async fetchByField(
    userId: string,
    collection: SyncedCollection,
    field: string,
    value: string,
  ): Promise<JsonDoc[]> {
    const rows = await this.prisma.syncDocument.findMany({
      where: { userId, collection, deletedAt: null, doc: { path: [field], equals: value } },
      select: { doc: true },
    });
    return rows.map((r) => r.doc as JsonDoc);
  }

  /** A new, unread notification goes to the phones right away: over the hub and by push. */
  private announce(userId: string, doc: JsonDoc): void {
    if (doc.read === true) return;
    const text = (key: string) => (typeof doc[key] === 'string' ? (doc[key] as string) : '');
    const payload = {
      id: text('id'),
      level: text('level'),
      kind: text('kind'),
      title: text('title'),
      body: text('body'),
      linkPage: text('linkPage'),
      linkId: text('linkId') || null,
      createdAt: text('createdAt'),
    };
    this.hub.pushToMobiles(userId, 'notification', payload);
    void this.push.sendToUser(userId, {
      title: payload.title || 'Offerpath',
      body: payload.body,
      data: { ...payload, linkId: payload.linkId ?? '' },
    });
  }
}
