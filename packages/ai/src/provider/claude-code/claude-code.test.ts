import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AIContractViolation, AIUnavailable, describeAIFailure } from '../ai-provider.port.js';
import type { CliJob, CliOutcome } from '../cli/run-cli.js';

import {
  CLAUDE_CODE_DENIED_TOOLS,
  ClaudeCodeProvider,
  claudeCodeArgs,
} from './claude-code.provider.js';

/**
 * The provider, driven through a fake desktop executor. What is under test is
 * everything between the prompt and the parsed object: the job handed to the
 * desktop, the result envelope, and each way the CLI can let us down.
 */

const ctx = { userId: 'u1', agent: 'test', promptVersion: 'v1' };

const prompt = (content = 'Say hello') => ({
  model: 'fast' as const,
  messages: [{ role: 'user' as const, content }],
});

const OK_RESULT = `{"type":"result","is_error":false,"result":"hi","structured_output":{"answer":"hi","score":3},"usage":{"input_tokens":9,"output_tokens":20,"cache_read_input_tokens":12000,"cache_creation_input_tokens":3000}}`;

const schema = z.object({ answer: z.string(), score: z.number() });

/** A provider whose desktop answers with `outcome` and records each job. */
function withDesktop(outcome: Partial<CliOutcome> | ((job: CliJob) => Partial<CliOutcome>)) {
  const jobs: CliJob[] = [];
  const provider = new ClaudeCodeProvider({
    modelFast: 'haiku',
    modelReasoning: 'opus',
    timeoutMs: 90_000,
    executor: async (job) => {
      jobs.push(job);
      const out = typeof outcome === 'function' ? outcome(job) : outcome;
      return { stdout: '', stderr: '', code: 0, answer: null, ...out };
    },
  });
  return { provider, jobs };
}

/** What the user would be shown for a thrown failure. */
async function failureOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return describeAIFailure(error);
  }
  throw new Error('expected a failure');
}

describe('Claude Code on the desktop', () => {
  it('parses the schema-validated object the CLI hands back', async () => {
    const { provider } = withDesktop({ stdout: OK_RESULT });

    const result = await provider.structured({
      prompt: prompt(),
      schema,
      schemaName: 'Answer',
      context: ctx,
    });

    expect(result.data).toEqual({ answer: 'hi', score: 3 });
    expect(result.repairAttempts).toBe(0);
  });

  it('counts cached context as prompt tokens', async () => {
    const { provider } = withDesktop({ stdout: OK_RESULT });

    const result = await provider.structured({
      prompt: prompt(),
      schema,
      schemaName: 'Answer',
      context: ctx,
    });

    // 9 + 3000 + 12000: reporting 9 would hide the harness every call carries.
    expect(result.usage.promptTokens).toBe(15_009);
    expect(result.usage.completionTokens).toBe(20);
  });

  it('hands the desktop a job by meaning: prompt text, strict schema, model', async () => {
    const { provider, jobs } = withDesktop({ stdout: OK_RESULT });
    const awkward = 'He said "no" & ran\nthen: stopped';

    await provider.structured({
      prompt: {
        model: 'reasoning',
        messages: [
          { role: 'system', content: 'S' },
          { role: 'user', content: awkward },
        ],
      },
      schema,
      schemaName: 'probe',
      context: ctx,
    });

    expect(jobs[0]).toMatchObject({
      tool: 'CLAUDE_CODE',
      system: 'S',
      conversation: awkward,
      model: 'opus',
      timeoutMs: 90_000,
    });
    expect(jobs[0]!.jsonSchema).toMatchObject({ type: 'object', additionalProperties: false });
  });

  it('honours the tier, and a caller’s model override over it', async () => {
    const { provider, jobs } = withDesktop({ stdout: OK_RESULT });

    await provider.structured({ prompt: prompt(), schema, schemaName: 'A', context: ctx });
    await provider.structured({
      prompt: { ...prompt(), model: 'reasoning' },
      schema,
      schemaName: 'A',
      context: ctx,
    });
    await provider.structured({
      prompt: prompt(),
      schema,
      schemaName: 'A',
      context: { ...ctx, modelOverride: 'sonnet' },
    });

    expect(jobs.map((job) => job.model)).toEqual(['haiku', 'opus', 'sonnet']);
  });

  it('asks plain-text calls for no schema', async () => {
    const { provider, jobs } = withDesktop({ stdout: OK_RESULT });

    const result = await provider.generate({ prompt: prompt(), context: ctx });

    expect(result.text).toBe('hi');
    expect(jobs[0]!.jsonSchema).toBeNull();
  });

  it('passes the CLI’s own words through when it does not return JSON', async () => {
    const { provider } = withDesktop({ stdout: 'Invalid API key. Please run /login' });

    const detail = await failureOf(() =>
      provider.structured({ prompt: prompt(), schema, schemaName: 'A', context: ctx }),
    );

    expect(detail).toContain('Invalid API key');
  });

  it('fails as Claude Code fails when the desktop got nothing back', async () => {
    const { provider } = withDesktop({ stdout: '', stderr: 'Not logged in', code: 1 });

    const detail = await failureOf(() => provider.generate({ prompt: prompt(), context: ctx }));

    expect(detail).toContain('Not logged in');
  });

  it('surfaces an error envelope rather than treating it as an answer', async () => {
    const { provider } = withDesktop({
      stdout: `{"type":"result","is_error":true,"subtype":"error_during_execution","result":"rate limit reached"}`,
    });

    const detail = await failureOf(() =>
      provider.structured({ prompt: prompt(), schema, schemaName: 'A', context: ctx }),
    );

    expect(detail).toContain('rate limit reached');
  });

  it('fails the contract when the CLI returns no structured output', async () => {
    const { provider } = withDesktop({
      stdout: `{"type":"result","is_error":false,"result":"some prose instead"}`,
    });

    await expect(
      provider.structured({ prompt: prompt(), schema, schemaName: 'A', context: ctx }),
    ).rejects.toThrow(AIContractViolation);
  });

  it('fails the contract when the object does not match the schema', async () => {
    const { provider } = withDesktop({
      stdout: `{"type":"result","is_error":false,"structured_output":{"answer":"hi"}}`,
    });

    await expect(
      provider.structured({ prompt: prompt(), schema, schemaName: 'A', context: ctx }),
    ).rejects.toThrow(AIContractViolation);
  });

  it('passes on the executor’s own failure (no desktop online)', async () => {
    const provider = new ClaudeCodeProvider({
      modelFast: 'haiku',
      modelReasoning: 'opus',
      timeoutMs: 1_000,
      executor: async (_job, context) => {
        throw new AIUnavailable(context.agent, new Error('Your desktop is offline'));
      },
    });

    const detail = await failureOf(() => provider.generate({ prompt: prompt(), context: ctx }));

    expect(detail).toContain('Your desktop is offline');
  });

  it('refuses embeddings instead of inventing vectors', async () => {
    const { provider } = withDesktop({ stdout: OK_RESULT });

    await expect(provider.embed({ inputs: ['a'], context: ctx })).rejects.toThrow(AIUnavailable);
  });

  it('offers aliases rather than pinned snapshots', async () => {
    const { provider } = withDesktop({ stdout: OK_RESULT });

    const models = await provider.listModels(ctx);

    expect(models.map((model) => model.id)).toEqual(['haiku', 'sonnet', 'opus']);
  });

  it('builds exactly this argument list, which the Rust copy must match', () => {
    expect(
      claudeCodeArgs({
        tool: 'CLAUDE_CODE',
        system: 'S',
        conversation: 'Q',
        jsonSchema: { type: 'object' },
        model: 'haiku',
        timeoutMs: 1,
      }),
    ).toEqual([
      '-p',
      '--output-format',
      'json',
      '--model',
      'haiku',
      '--disallowedTools',
      CLAUDE_CODE_DENIED_TOOLS.join(','),
      '--system-prompt',
      'S',
      '--json-schema',
      '{"type":"object"}',
    ]);
  });

  it('denies every tool that touches files, commands or the network', () => {
    for (const tool of ['Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'Task']) {
      expect(CLAUDE_CODE_DENIED_TOOLS).toContain(tool);
    }
  });
});
