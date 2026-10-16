import type { CallContext, PromptSpec } from '../ai-provider.port.js';

/**
 * The contract between the server and the desktop for one AI call.
 *
 * The server never runs AI. Every call becomes a `CliJob`, handed to the
 * user's own desktop over the hub; the desktop runs its local Claude CLI and
 * returns what it printed (`CliOutcome`).
 *
 * Jobs are described by meaning, never as a command line. The desktop builds
 * the argument list itself (`claudeCodeArgs` is the reference it mirrors) and
 * runs nothing else, so the hub cannot be used to run arbitrary commands on
 * anyone's machine.
 */

/** The one local AI tool Offerpath drives. */
export type CliTool = 'CLAUDE_CODE';

/** One prompt for the Claude CLI, described by meaning rather than by argv. */
export interface CliJob {
  tool: CliTool;
  system: string | null;
  conversation: string;
  /** Already strict. Null for a plain-text answer. */
  jsonSchema: Record<string, unknown> | null;
  /** A model name the CLI understands (an alias such as "sonnet", or a full id). */
  model: string;
  timeoutMs: number;
}

/** What a run left behind; the provider reads its own success out of it. */
export interface CliOutcome {
  stdout: string;
  stderr: string;
  code: number | null;
  /** Unused by Claude (it answers on stdout); kept so the wire shape stays stable. */
  answer: string | null;
}

/**
 * Runs a job on the user's desktop. Rejects with `AIUnavailable` when it could
 * not run at all: no desktop online, Claude missing, timed out.
 */
export type CliExecutor = (job: CliJob, context: CallContext) => Promise<CliOutcome>;

/**
 * Flattens a prompt into one system string and one user turn.
 *
 * The CLI takes a single prompt, so a conversation has to be written out
 * rather than sent as turns. Roles are labelled so the model can still tell
 * who said what.
 */
export function flattenPrompt(prompt: PromptSpec): { system: string | null; conversation: string } {
  const system = prompt.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');

  const rest = prompt.messages.filter((message) => message.role !== 'system');

  // A lone user message is by far the common case (every generation agent),
  // and sending it unlabelled keeps those prompts exactly as written.
  const conversation =
    rest.length === 1
      ? rest[0]!.content
      : rest
          .map(
            (message) =>
              `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`,
          )
          .join('\n\n');

  return { system: system.length > 0 ? system : null, conversation };
}
