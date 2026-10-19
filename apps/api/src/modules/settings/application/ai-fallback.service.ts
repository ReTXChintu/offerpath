import { Inject, Injectable, Logger } from '@nestjs/common';

import { OpenAIProvider, describeAIFailure, type ModelOption } from '@offerpath/ai';
import type { AppConfig } from '@offerpath/config';

import { Problems } from '../../../common/http/problem-details.js';
import { decryptSecret, encryptSecret, lastFour } from '../../../common/secrets/secret-box.js';
import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

export interface FallbackKeyView {
  /** Whether a key is saved. The key itself is never returned. */
  configured: boolean;
  last4: string | null;
  modelFast: string;
  modelReasoning: string;
  /** False when the server has no ENCRYPTION_KEY, so no key can be saved. */
  available: boolean;
}

export interface FallbackKeyInput {
  /** Omit to keep the saved key and change only the models. */
  apiKey?: string | null;
  modelFast?: string | null;
  modelReasoning?: string | null;
}

/**
 * The user's own OpenAI key: the fallback for interview prep when their
 * desktop (Claude) is offline. Claude is always tried first.
 *
 * Stored encrypted; the API returns only `configured` and the last four
 * characters. A key that can be read back out of an API ends up in a log.
 */
@Injectable()
export class AiFallbackService {
  private readonly logger = new Logger(AiFallbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get passphrase(): string {
    return this.config.env.ENCRYPTION_KEY;
  }

  get available(): boolean {
    return this.passphrase.trim().length >= 16;
  }

  async view(userId: string): Promise<FallbackKeyView> {
    const row = await this.prisma.aiFallbackKey.findUnique({ where: { userId } });
    return {
      configured: !!row,
      last4: row?.keyLast4 ?? null,
      modelFast: row?.modelFast ?? this.config.env.OPENAI_FALLBACK_MODEL_FAST,
      modelReasoning: row?.modelReasoning ?? this.config.env.OPENAI_FALLBACK_MODEL_REASONING,
      available: this.available,
    };
  }

  async save(userId: string, input: FallbackKeyInput): Promise<FallbackKeyView> {
    if (!this.available) {
      throw Problems.badRequest(
        'This server has no ENCRYPTION_KEY, so it cannot store an API key. Ask its owner to set one.',
      );
    }
    const existing = await this.prisma.aiFallbackKey.findUnique({ where: { userId } });
    const apiKey = input.apiKey?.trim();
    if (!apiKey && !existing) throw Problems.badRequest('Enter your OpenAI API key.');

    if (apiKey) {
      // Checked before saving: a key that can't list models would only fail later, offline.
      await this.check(apiKey);
    }
    const models = {
      ...(input.modelFast !== undefined ? { modelFast: input.modelFast || null } : {}),
      ...(input.modelReasoning !== undefined
        ? { modelReasoning: input.modelReasoning || null }
        : {}),
    };
    if (apiKey) {
      const keyCipher = encryptSecret(apiKey, this.passphrase);
      await this.prisma.aiFallbackKey.upsert({
        where: { userId },
        create: { userId, keyCipher, keyLast4: lastFour(apiKey), ...models },
        update: { keyCipher, keyLast4: lastFour(apiKey), ...models },
      });
    } else {
      await this.prisma.aiFallbackKey.update({ where: { userId }, data: models });
    }
    return this.view(userId);
  }

  async remove(userId: string): Promise<FallbackKeyView> {
    await this.prisma.aiFallbackKey.deleteMany({ where: { userId } });
    return this.view(userId);
  }

  /** The models this user's key can use, straight from OpenAI. */
  async models(userId: string): Promise<ModelOption[]> {
    const provider = await this.providerFor(userId);
    if (!provider) throw Problems.notFound('Saved OpenAI key');
    return provider.listModels({ userId, agent: 'settings', promptVersion: 'v1' });
  }

  /** An OpenAI provider on this user's key, or null when they saved none. */
  async providerFor(userId: string): Promise<OpenAIProvider | null> {
    if (!this.available) return null;
    const row = await this.prisma.aiFallbackKey.findUnique({ where: { userId } });
    if (!row) return null;
    let apiKey: string;
    try {
      apiKey = decryptSecret(row.keyCipher, this.passphrase);
    } catch (error) {
      // ENCRYPTION_KEY changed since it was saved: the key is unreadable now.
      this.logger.warn(`fallback key for ${userId} can't be decrypted: ${String(error)}`);
      return null;
    }
    return this.build(apiKey, row.modelFast, row.modelReasoning);
  }

  private build(apiKey: string, modelFast?: string | null, modelReasoning?: string | null) {
    return new OpenAIProvider({
      apiKey,
      baseURL: 'https://api.openai.com/v1',
      modelFast: modelFast || this.config.env.OPENAI_FALLBACK_MODEL_FAST,
      modelReasoning: modelReasoning || this.config.env.OPENAI_FALLBACK_MODEL_REASONING,
      embeddingModel: 'text-embedding-3-small',
      timeoutMs: this.config.env.AI_REQUEST_TIMEOUT_MS,
      maxRetries: 2,
    });
  }

  private async check(apiKey: string): Promise<void> {
    try {
      await this.build(apiKey).listModels({ agent: 'settings', promptVersion: 'v1' });
    } catch (error) {
      throw Problems.badRequest(`OpenAI refused this key: ${describeAIFailure(error)}`);
    }
  }
}
