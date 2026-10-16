import {
  AIUnavailable,
  CLAUDE_MODEL_ALIASES,
  ClaudeCodeProvider,
  type AIProvider,
  type CallContext,
  type EmbedRequest,
  type EmbedResult,
  type GenerateRequest,
  type GenerateResult,
  type ModelOption,
  type StreamChunk,
  type StructuredRequest,
  type StructuredResult,
} from '@offerpath/ai';

import type { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import type { AiJobsService } from '../../hub/application/ai-jobs.service.js';

/** Defaults when a user has never opened Settings → AI. */
export const DEFAULT_MODELS = { fast: 'sonnet', reasoning: 'opus' } as const;

/**
 * The application's one AI provider: Claude, on the calling user's desktop.
 *
 * Each call reads that user's model choices (fast and reasoning tiers) and
 * runs through a `ClaudeCodeProvider` whose executor is the user's desktop,
 * via `ai_jobs` and the hub. The fifteen agent call sites never learn where
 * the answer came from; `CallContext.userId` is already threaded through
 * every one of them.
 */
export class DesktopClaudeProvider implements AIProvider {
  readonly name = 'claude-code';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: AiJobsService,
  ) {}

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    return (await this.forUser(req.context)).generate(req);
  }

  async *stream(req: GenerateRequest): AsyncIterable<StreamChunk> {
    yield* (await this.forUser(req.context)).stream(req);
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    return (await this.forUser(req.context)).structured(req);
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    throw new AIUnavailable(
      req.context.agent,
      new Error('Claude Code does not provide embeddings'),
    );
  }

  async listModels(_context: CallContext): Promise<ModelOption[]> {
    return CLAUDE_MODEL_ALIASES;
  }

  private async forUser(context: CallContext): Promise<ClaudeCodeProvider> {
    const userId = context.userId;
    if (!userId) {
      // Nobody's desktop to run it on: a background task with no user behind it.
      throw new AIUnavailable(
        context.agent,
        new Error('AI runs on a user’s desktop; this call has no user'),
      );
    }
    const prefs = await this.prisma.userPreferences.findUnique({
      where: { userId },
      select: { claudeModelFast: true, claudeModelReasoning: true },
    });
    return new ClaudeCodeProvider({
      modelFast: prefs?.claudeModelFast ?? DEFAULT_MODELS.fast,
      modelReasoning: prefs?.claudeModelReasoning ?? DEFAULT_MODELS.reasoning,
      timeoutMs: this.jobs.timeoutMs,
      executor: this.jobs.executorFor(userId),
    });
  }
}
