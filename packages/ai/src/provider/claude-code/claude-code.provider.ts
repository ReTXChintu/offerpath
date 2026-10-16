import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  AIContractViolation,
  AIUnavailable,
  type AIProvider,
  type CallContext,
  type EmbedRequest,
  type EmbedResult,
  type GenerateRequest,
  type GenerateResult,
  type ModelOption,
  type PromptSpec,
  type StreamChunk,
  type StructuredRequest,
  type StructuredResult,
} from '../ai-provider.port.js';
import { flattenPrompt, type CliExecutor, type CliJob, type CliOutcome } from '../cli/run-cli.js';
import { stripAbsent, toStrictSchema } from '../schema/strict-schema.js';

/**
 * Claude through the user's own Claude Code CLI, on their own desktop.
 *
 * The only provider Offerpath has. The server builds the job (prompt, strict
 * JSON schema, model) and the executor hands it to the user's desktop, which
 * runs `claude -p` and returns the CLI's JSON envelope. Nothing runs here.
 *
 * Structured output is real, not scraped: `--json-schema` makes the CLI
 * validate against the schema and hand the object back in its own
 * `structured_output` field. The answer is then checked again here against
 * the agent's Zod contract, so a desktop can never feed the server an object
 * of the wrong shape.
 *
 * Every call carries Claude Code's own harness, roughly 20-25k tokens of
 * system prompt, mostly served from its cache; usage reports it honestly.
 */

export interface ClaudeCodeProviderOptions {
  modelFast: string;
  modelReasoning: string;
  timeoutMs: number;
  /** Runs the job on the user's desktop. */
  executor: CliExecutor;
}

/**
 * Everything the CLI can do to a filesystem or the network, denied.
 *
 * Learning jobs explain concepts and grade answers. They have no business
 * reading files, running commands or browsing, and a coding agent left with
 * its tools will use them. The desktop also runs them in an empty folder.
 */
export const CLAUDE_CODE_DENIED_TOOLS = [
  'Bash',
  'BashOutput',
  'KillShell',
  'Read',
  'Write',
  'Edit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
  'TodoWrite',
];

/** The CLI's own result envelope, as `--output-format json` emits it. */
interface CliResult {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  session_id?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export class ClaudeCodeProvider implements AIProvider {
  readonly name = 'claude-code';

  constructor(private readonly options: ClaudeCodeProviderOptions) {}

  /** The model for one call: a caller's override wins over the prompt's tier. */
  private resolveModel(prompt: PromptSpec, context?: CallContext): string {
    if (context?.modelOverride) return context.modelOverride;
    return prompt.model === 'reasoning' ? this.options.modelReasoning : this.options.modelFast;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const startedAt = Date.now();
    const model = this.resolveModel(req.prompt, req.context);
    const result = await this.run(req.prompt, model, req.context, null);

    return {
      text: result.result ?? '',
      usage: usageOf(result),
      model,
      latencyMs: Date.now() - startedAt,
    };
  }

  /** One chunk, then done: the answer genuinely arrives in one piece. */
  async *stream(req: GenerateRequest): AsyncIterable<StreamChunk> {
    const { text } = await this.generate(req);
    if (text) yield { delta: text, done: false };
    yield { delta: '', done: true };
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const startedAt = Date.now();
    const model = this.resolveModel(req.prompt, req.context);

    // Every property required, `additionalProperties: false`, optionals turned
    // nullable with a map of which ones, so the invented nulls can be removed
    // again before Zod sees them.
    const { schema: jsonSchema, absence } = toStrictSchema(
      zodToJsonSchema(req.schema, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<
        string,
        unknown
      >,
    );

    const result = await this.run(req.prompt, model, req.context, jsonSchema);

    if (result.structured_output === undefined || result.structured_output === null) {
      throw new AIContractViolation(
        req.context.agent,
        [`no structured output (${result.subtype ?? result.type})`],
        result.result ?? '',
      );
    }

    const parsed = req.schema.safeParse(stripAbsent(result.structured_output, absence));
    if (!parsed.success) {
      throw new AIContractViolation(
        req.context.agent,
        parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
        JSON.stringify(result.structured_output).slice(0, 2_000),
      );
    }

    return {
      data: parsed.data,
      usage: usageOf(result),
      model,
      latencyMs: Date.now() - startedAt,
      // Never repaired: the CLI validates against the schema before answering.
      repairAttempts: 0,
    };
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    // There is no embeddings endpoint behind the CLI, and zero vectors would
    // quietly poison anything built on them.
    throw new AIUnavailable(
      req.context.agent,
      new Error('Claude Code does not provide embeddings'),
    );
  }

  /** CLI aliases rather than dated ids, so the list can't name a retired snapshot. */
  async listModels(_context: CallContext): Promise<ModelOption[]> {
    return CLAUDE_MODEL_ALIASES;
  }

  private async run(
    prompt: PromptSpec,
    model: string,
    context: CallContext,
    jsonSchema: Record<string, unknown> | null,
  ): Promise<CliResult> {
    const { system, conversation } = flattenPrompt(prompt);
    const job: CliJob = {
      tool: 'CLAUDE_CODE',
      system,
      conversation,
      jsonSchema,
      model,
      timeoutMs: this.options.timeoutMs,
    };

    const raw = stdoutOf(await this.options.executor(job, context), context);

    let parsed: CliResult;
    try {
      parsed = JSON.parse(raw) as CliResult;
    } catch {
      // Not JSON at all: the CLI failed before writing its envelope (not
      // signed in, unknown model). Its own words are the useful part.
      throw new AIUnavailable(
        context.agent,
        new Error(`Claude Code did not return JSON: ${raw.slice(0, 400) || '(no output)'}`),
      );
    }

    if (parsed.is_error) {
      throw new AIUnavailable(
        context.agent,
        new Error(parsed.result ?? `Claude Code failed (${parsed.subtype ?? 'unknown'})`),
      );
    }

    return parsed;
  }
}

/** The models offered in Settings. */
export const CLAUDE_MODEL_ALIASES: ModelOption[] = [
  { id: 'haiku', label: 'Haiku: fastest' },
  { id: 'sonnet', label: 'Sonnet: balanced' },
  { id: 'opus', label: 'Opus: most capable' },
];

/**
 * The CLI's arguments for one job. The desktop (`offerpath-core`) builds the
 * identical list in Rust and runs nothing else; change both together. The
 * prompt itself goes over stdin, never as an argument.
 */
export function claudeCodeArgs(job: CliJob): string[] {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--model',
    job.model,
    '--disallowedTools',
    CLAUDE_CODE_DENIED_TOOLS.join(','),
  ];

  if (job.system) args.push('--system-prompt', job.system);
  if (job.jsonSchema) args.push('--json-schema', JSON.stringify(job.jsonSchema));

  return args;
}

/**
 * The envelope text, failing as Claude Code fails. A run that printed
 * something is parsed whatever its exit code, because the CLI reports most of
 * its own failures inside a JSON envelope on stdout.
 */
function stdoutOf(outcome: CliOutcome, context: CallContext): string {
  if (outcome.code === 0 || outcome.stdout.trim().length > 0) return outcome.stdout.trim();

  throw new AIUnavailable(
    context.agent,
    new Error(
      `Claude Code exited with ${outcome.code}: ${outcome.stderr.trim().slice(0, 400) || '(no output)'}`,
    ),
  );
}

/** Prompt tokens including cache reads and writes: real context the call carried. */
function usageOf(result: CliResult) {
  const usage = result.usage ?? {};

  return {
    promptTokens:
      (usage.input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0),
    completionTokens: usage.output_tokens ?? 0,
  };
}
