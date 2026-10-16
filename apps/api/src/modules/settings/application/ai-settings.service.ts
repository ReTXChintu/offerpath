import { Injectable } from '@nestjs/common';

import { CLAUDE_MODEL_ALIASES, type ModelOption } from '@offerpath/ai';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { DEFAULT_MODELS } from '../../ai/infrastructure/desktop-claude.provider.js';
import { HubService } from '../../hub/application/hub.service.js';

export interface ClaudeModels {
  /** Grading, hints, short answers. */
  fast: string;
  /** Curriculum, roadmaps, interview reports. */
  reasoning: string;
  /** The tutor chat. Null follows `fast`. */
  tutor: string | null;
}

export interface AISettingsView {
  models: ClaudeModels;
  options: ModelOption[];
  /** The desktop that runs this account's AI, if it is online. */
  desktop: {
    online: boolean;
    claudeAvailable: boolean;
    detail: string | null;
    version: string | null;
  };
}

/**
 * The only AI settings there are: which Claude model each kind of work uses.
 *
 * Claude runs on the user's own desktop with their own sign-in, so there is
 * no vendor to choose and no key to store. What is shown besides the models
 * is whether that desktop is online and has Claude.
 */
@Injectable()
export class AISettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: HubService,
  ) {}

  async view(userId: string): Promise<AISettingsView> {
    const desktop = this.hub.desktopInfo(userId);
    return {
      models: await this.models(userId),
      options: CLAUDE_MODEL_ALIASES,
      desktop: {
        online: desktop !== null,
        claudeAvailable: desktop?.claude.available ?? false,
        detail: desktop?.claude.detail ?? null,
        version: desktop?.version ?? null,
      },
    };
  }

  async update(userId: string, change: Partial<ClaudeModels>): Promise<AISettingsView> {
    const data = {
      ...(change.fast !== undefined ? { claudeModelFast: change.fast } : {}),
      ...(change.reasoning !== undefined ? { claudeModelReasoning: change.reasoning } : {}),
      ...(change.tutor !== undefined ? { claudeModelTutor: change.tutor } : {}),
    };
    await this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.view(userId);
  }

  /** The tutor's model when the user pinned one; null follows the fast tier. */
  async tutorModel(userId: string): Promise<string | null> {
    return (await this.models(userId)).tutor;
  }

  /** Whether an AI call for this user can run right now: their desktop is online with Claude. */
  aiAvailable(userId: string): boolean {
    const desktop = this.hub.desktopInfo(userId);
    return !!desktop && desktop.claude.available;
  }

  private async models(userId: string): Promise<ClaudeModels> {
    const prefs = await this.prisma.userPreferences.findUnique({
      where: { userId },
      select: { claudeModelFast: true, claudeModelReasoning: true, claudeModelTutor: true },
    });
    return {
      fast: prefs?.claudeModelFast ?? DEFAULT_MODELS.fast,
      reasoning: prefs?.claudeModelReasoning ?? DEFAULT_MODELS.reasoning,
      tutor: prefs?.claudeModelTutor ?? null,
    };
  }
}
