import { Inject, Injectable } from '@nestjs/common';

import { AIUnavailable, type AIProvider } from '@offerpath/ai';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { AI_PROVIDER } from '../../ai/ai.tokens.js';
import { RecordingAIProvider } from '../../ai/infrastructure/recording-ai.provider.js';
import { AiFallbackService } from '../../settings/application/ai-fallback.service.js';
import { AISettingsService } from '../../settings/application/ai-settings.service.js';

export type PrepAiSource = 'desktop' | 'openai';

export class NoPrepAiError extends Error {
  constructor() {
    super(
      'Your laptop is offline and no OpenAI fallback key is saved. ' +
        'Open Offerpath on your laptop, or add a key in Settings → AI.',
    );
    this.name = 'NoPrepAiError';
  }
}

/**
 * Where interview-prep AI runs, per user and per call:
 *
 * 1. Claude on the user's own desktop, whenever it is online with Claude;
 * 2. otherwise the user's own OpenAI key, if they saved one;
 * 3. otherwise nowhere: `NoPrepAiError`, and the prep waits for the desktop.
 *
 * If the desktop drops in the middle of a call, the call is retried on the
 * fallback key rather than failing.
 */
@Injectable()
export class PrepAiRouter {
  constructor(
    @Inject(AI_PROVIDER) private readonly desktop: AIProvider,
    private readonly settings: AISettingsService,
    private readonly fallback: AiFallbackService,
    private readonly prisma: PrismaService,
  ) {}

  async run<T>(
    userId: string,
    call: (provider: AIProvider) => Promise<T>,
  ): Promise<{ result: T; source: PrepAiSource }> {
    if (this.settings.aiAvailable(userId)) {
      try {
        return { result: await call(this.desktop), source: 'desktop' };
      } catch (error) {
        if (!(error instanceof AIUnavailable)) throw error;
        // The desktop went away mid-call: the fallback, if there is one.
        const openai = await this.openai(userId);
        if (!openai) throw error;
        return { result: await call(openai), source: 'openai' };
      }
    }
    const openai = await this.openai(userId);
    if (!openai) throw new NoPrepAiError();
    return { result: await call(openai), source: 'openai' };
  }

  /** Whether a call for this user could run right now. */
  async canRun(userId: string): Promise<PrepAiSource | null> {
    if (this.settings.aiAvailable(userId)) return 'desktop';
    return (await this.fallback.view(userId)).configured && this.fallback.available
      ? 'openai'
      : null;
  }

  private async openai(userId: string): Promise<AIProvider | null> {
    const provider = await this.fallback.providerFor(userId);
    // Recorded in ai_interactions like every other call.
    return provider ? new RecordingAIProvider(provider, this.prisma) : null;
  }
}
