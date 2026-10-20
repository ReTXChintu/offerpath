import Editor, { type OnMount } from '@monaco-editor/react';
import {
  Alert,
  Badge,
  BulletList,
  Button,
  Card,
  ConfirmDialog,
  Icon,
  PageHeader,
  Panel,
  Select,
  SkillMeter,
  Spinner as UiSpinner,
  Textarea,
  type BadgeVariant,
} from '@offerpath/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { describeError, RequestError } from '../../components/AiOffline';
import { CodeBlock } from '../../components/CodeBlock';
import { Markdown } from '../../components/Markdown';
import { Spinner, Tabs } from '../../components/ui';
import { learnPaths, LearnLink, useLearnNavigate } from '../../context';
import { ApiError, isAiUnavailable } from '../../lib/api';
import {
  isServiceUnavailable,
  useAnswerMockInterview,
  useDeleteMockInterview,
  useFinishMockInterview,
  useInterviewPrep,
  useMockInterview,
  usePrepAiSource,
  useRetryMockReply,
  useRetryMockReport,
  useStartMockInterview,
  type CodingProblem,
  type MockInterviewView,
  type MockReport,
  type MockReportQuestion,
  type MockTurnView,
  type PrepView,
} from '../../lib/interview-prep';
import { formatWhen } from '../../lib/when';

import {
  formatScore,
  interviewerByLabel,
  MockStatusBadge,
  prepTitle,
  scoreVariant,
  stageLabel,
  VerdictBadge,
} from './shared';

/** When nothing can play the interviewer: the laptop is off and no OpenAI key is saved. */
export const INTERVIEWER_UNAVAILABLE =
  'Your laptop is offline and no OpenAI key is saved, so the interviewer cannot reply right now. Your answer is saved: retry when your laptop is online, or add a key in Settings → AI.';

/** What to say about a failed interviewer or report request. */
export function mockErrorMessage(error: unknown): string {
  if (isAiUnavailable(error) || isServiceUnavailable(error)) {
    // The server says why when it knows (the OpenAI key was refused, say).
    const detail = error instanceof ApiError ? error.problem.detail : undefined;
    return detail && !detail.startsWith('AI runs on your desktop')
      ? detail
      : INTERVIEWER_UNAVAILABLE;
  }
  return describeError(error);
}

/** The languages a coding answer can be written in (Monaco's ids). */
export const CODE_LANGUAGES: { id: string; label: string }[] = [
  { id: 'typescript', label: 'TypeScript' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'cpp', label: 'C++' },
  { id: 'go', label: 'Go' },
  { id: 'csharp', label: 'C#' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'rust', label: 'Rust' },
];

const TECH_LANGUAGE: [RegExp, string][] = [
  [/^(typescript|ts|angular|nest(\.?js)?|deno)$/, 'typescript'],
  [/^(python|django|flask|fastapi|pandas)$/, 'python'],
  [/^(java|spring( boot)?|j2ee)$/, 'java'],
  [/^(c\+\+|cpp)$/, 'cpp'],
  [/^(go|golang)$/, 'go'],
  [/^(c#|csharp|\.net|asp\.net|dotnet)$/, 'csharp'],
  [/^(kotlin)$/, 'kotlin'],
  [/^(rust)$/, 'rust'],
  [/^(javascript|js|node(\.?js)?|react|vue(\.js)?|express)$/, 'javascript'],
];

/** The coding language to start with: the first of the prep's technologies that is one. */
export function defaultCodeLanguage(technologies: readonly string[]): string {
  for (const tech of technologies) {
    const t = tech.trim().toLowerCase();
    const found = TECH_LANGUAGE.find(([pattern]) => pattern.test(t));
    if (found) return found[1];
  }
  return 'python';
}

const KIND_NOTE: Record<string, string> = {
  FOLLOW_UP: 'Follow-up',
  CROSS_QUESTION: 'Cross-question',
  CODING: 'Coding problem',
  CLOSING: 'Closing',
};

const ASSESSMENT: Record<string, { label: string; variant: BadgeVariant }> = {
  STRONG: { label: 'Strong', variant: 'success' },
  CORRECT: { label: 'Correct', variant: 'success' },
  PARTIAL: { label: 'Partly right', variant: 'warning' },
  WRONG: { label: 'Wrong', variant: 'error' },
  NO_ANSWER: { label: 'No answer', variant: 'neutral' },
};

const DIMENSION_LABEL: Record<string, string> = {
  SELF_PRESENTATION: 'Self-presentation',
  TECHNICAL_DEPTH: 'Technical depth',
  PROBLEM_SOLVING: 'Problem solving',
  CODING: 'Coding',
  COMMUNICATION: 'Communication',
  LANGUAGE: 'Language',
};

/**
 * A mock interview for one prep: a live conversation with an AI interviewer
 * through four stages, then a report. Designed to feel like the real thing:
 * the interviewer's questions on one side, your answers on the other, a
 * problem card for coding, and language corrections under each answer once
 * the interviewer has replied. Scores wait for the report.
 */
export function MockInterviewPage({ interviewId }: { interviewId: string }) {
  const navigate = useLearnNavigate();
  const query = useMockInterview(interviewId);
  const interview = query.data;
  const prep = useInterviewPrep(interview?.prepId ?? '');

  if (query.isLoading) return <Spinner label="Loading the mock interview" />;
  if (!interview) {
    return (
      <div>
        <PageHeader eyebrow="Mock interview" title="Mock interview" />
        <Alert
          status="error"
          title="This mock interview did not load"
          actions={
            <>
              <Button size="sm" onClick={() => void query.refetch()}>
                Try again
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navigate(learnPaths.interviewPreps)}>
                All preps
              </Button>
            </>
          }
        >
          {describeError(query.error)}
        </Alert>
      </div>
    );
  }

  return <Interview interview={interview} prep={prep.data ?? null} />;
}

function Interview({ interview, prep }: { interview: MockInterviewView; prep: PrepView | null }) {
  const navigate = useLearnNavigate();
  const finish = useFinishMockInterview(interview.id);
  const restart = useStartMockInterview(interview.prepId);
  const remove = useDeleteMockInterview(interview.prepId);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState<'Report' | 'Transcript'>('Report');

  const live = interview.status === 'IN_PROGRESS';
  const by = interviewerByLabel(interview.aiSource);
  const prepPath = learnPaths.interviewPrep(interview.prepId);
  const startNew = () =>
    restart.mutate(
      { restart: true },
      { onSuccess: (view) => navigate(learnPaths.mockInterview(view.id)) },
    );

  return (
    <div className="mock-page">
      <PageHeader
        eyebrow="Mock interview"
        title={prep ? prepTitle(prep) : 'Mock interview'}
        subtitle={
          <span className="row items-center g2 wrap">
            <span>Started {formatWhen(interview.startedAt)}</span>
            <MockStatusBadge status={interview.status} />
            {by ? (
              <Badge variant="neutral" size="sm" icon="sparkles">
                {by}
              </Badge>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button variant="ghost" icon="arrowLeft" onClick={() => navigate(prepPath)}>
              Back to the prep
            </Button>
            {live ? (
              <Button variant="danger" icon="stop" onClick={() => setConfirmEnd(true)}>
                End interview
              </Button>
            ) : interview.status !== 'REPORTING' ? (
              <>
                <Button variant="primary" icon="mic" loading={restart.isPending} onClick={startNew}>
                  Start a new mock interview
                </Button>
                <Button variant="ghost" icon="trash" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <StageProgress interview={interview} />

      <RequestError error={restart.error ?? remove.error ?? finish.error} className="mb4" />

      {interview.status === 'COMPLETED' && interview.report ? (
        <div className="col g4">
          <Tabs
            tabs={['Report', 'Transcript']}
            active={tab}
            onChange={(t) => setTab(t as 'Report' | 'Transcript')}
          />
          {tab === 'Report' ? (
            <ReportView report={interview.report} turns={interview.turns} />
          ) : (
            <Transcript turns={interview.turns} />
          )}
        </div>
      ) : (
        <Conversation interview={interview} prep={prep} />
      )}

      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="End the interview now?"
        description="The interviewer stops here and writes your report from the answers so far."
        confirmLabel="End interview"
        loading={finish.isPending}
        onConfirm={() => finish.mutate(undefined, { onSettled: () => setConfirmEnd(false) })}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this mock interview?"
        description="Its transcript and report go with it."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(interview.id, {
            onSuccess: () => navigate(prepPath, { replace: true }),
            onSettled: () => setConfirmDelete(false),
          })
        }
      />
    </div>
  );
}

/** Intro → Technical → Coding → Wrap-up, with the current stage marked. */
function StageProgress({ interview }: { interview: MockInterviewView }) {
  const stages = interview.stages.length > 0 ? interview.stages : [interview.stage];
  const at = stages.indexOf(interview.stage);
  const finished = interview.status !== 'IN_PROGRESS';
  return (
    <ol className="mock-stages mb5" aria-label="Interview stages">
      {stages.map((stage, i) => {
        const done = i < at || (finished && i === at);
        const current = !finished && i === at;
        return (
          <li
            key={stage}
            className={`mock-stage${done ? ' is-done' : ''}${current ? ' is-current' : ''}`}
            aria-current={current ? 'step' : undefined}
          >
            <span className="mock-stage-bar" />
            <span className="row items-center g1">
              {done ? <Icon name="check" size={12} /> : null}
              {stageLabel(stage)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// -- The conversation -----------------------------------------------------------

function Conversation({
  interview,
  prep,
}: {
  interview: MockInterviewView;
  prep: PrepView | null;
}) {
  const answer = useAnswerMockInterview(interview.id);
  const reply = useRetryMockReply(interview.id);
  const report = useRetryMockReport(interview.id);
  const ai = usePrepAiSource();
  const bottomRef = useRef<HTMLDivElement>(null);

  const live = interview.status === 'IN_PROGRESS';
  const requesting = answer.isPending || reply.isPending;
  const thinking = live && (requesting || interview.replying);
  const failedReply = live && interview.awaitingReply && !interview.replying && !requesting;
  const pending = answer.isPending ? answer.variables : undefined;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [interview.turns.length, thinking, pending, interview.status]);

  const replyError = reply.error ?? (isServiceUnavailable(answer.error) ? answer.error : null);
  // A failed answer that was not saved (a conflict, the network): shown on its own.
  const answerError = answer.error && !isServiceUnavailable(answer.error) ? answer.error : null;

  return (
    <div className="mock-layout">
      <div className="col g4" style={{ minWidth: 0 }}>
        <Transcript turns={interview.turns}>
          {pending ? (
            <li className="mock-turn is-candidate is-pending">
              <div className="mock-bubble-wrap">
                <div className="mock-speaker t-caption">You</div>
                {pending.text ? <div className="mock-bubble">{pending.text}</div> : null}
                {pending.code ? (
                  <CodeBlock code={pending.code} language={pending.codeLanguage} />
                ) : null}
              </div>
            </li>
          ) : null}
          {thinking ? (
            <li className="mock-turn is-interviewer" role="status" aria-live="polite">
              <InterviewerAvatar />
              <div className="mock-bubble mock-typing">
                <span className="mock-dots" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                Interviewer is thinking…
              </div>
            </li>
          ) : null}
        </Transcript>

        {failedReply ? (
          <Alert
            status="warning"
            title="The interviewer did not reply"
            actions={
              <Button
                size="sm"
                variant="primary"
                icon="refresh"
                loading={reply.isPending}
                onClick={() => reply.mutate()}
              >
                Retry
              </Button>
            }
          >
            {replyError
              ? mockErrorMessage(replyError)
              : (interview.error ?? 'Your answer is saved. Ask the interviewer to reply again.')}
          </Alert>
        ) : null}

        {interview.status === 'REPORTING' ? (
          <Panel>
            <div className="row items-center g3" role="status" aria-live="polite">
              <UiSpinner label="Writing your report" />
              <div>
                <div className="t-h4">Writing your report…</div>
                <div className="t-small">
                  The interviewer is going over every answer. This takes a minute or two; the page
                  updates by itself, and you can leave and come back.
                </div>
              </div>
            </div>
          </Panel>
        ) : interview.status === 'FAILED' ? (
          <Alert
            status="error"
            title="The report did not finish"
            actions={
              <Button
                size="sm"
                variant="primary"
                icon="refresh"
                loading={report.isPending}
                onClick={() => report.mutate()}
              >
                Try again
              </Button>
            }
          >
            {report.error
              ? mockErrorMessage(report.error)
              : (interview.error ?? 'Something went wrong while writing it.')}
          </Alert>
        ) : interview.status === 'ABANDONED' ? (
          <Alert status="info" title="This interview was ended without a report">
            Start a new mock interview to try again.
          </Alert>
        ) : null}

        {live ? (
          <Composer
            interview={interview}
            prep={prep}
            disabled={requesting || interview.replying || interview.awaitingReply}
            sending={answer.isPending}
            onSend={(input) => answer.mutateAsync(input)}
          />
        ) : null}
        <RequestError error={answerError} />
        <div ref={bottomRef} />
      </div>

      <aside className="col g4" style={{ minWidth: 0 }} aria-label="About this interview">
        {live && !ai.isLoading && ai.data === null ? (
          <Alert status="warning" title="No AI to interview you right now">
            Your laptop is offline and no OpenAI key is saved: the interviewer cannot reply until
            your laptop is online.{' '}
            <LearnLink to={learnPaths.aiSettings}>Open Settings → AI</LearnLink>
          </Alert>
        ) : null}
        <Panel title="How it works">
          <BulletList
            items={[
              'Answer as you would out loud: full sentences, in your own words.',
              'The interviewer follows up on what you say, and pushes back when an answer is off.',
              'Coding questions open an editor next to your answer: explain your approach, then write the code.',
              'Language corrections appear under each answer. Scores wait for the report.',
            ]}
          />
          <div className="t-caption mt3">
            {interview.answered} {interview.answered === 1 ? 'answer' : 'answers'} so far · stage:{' '}
            {stageLabel(interview.stage)}
          </div>
        </Panel>
      </aside>
    </div>
  );
}

/** Every turn in order; `children` adds the turns still on their way. */
function Transcript({ turns, children }: { turns: MockTurnView[]; children?: ReactNode }) {
  const ordered = useMemo(() => [...turns].sort((a, b) => a.order - b.order), [turns]);
  return (
    <ol className="mock-transcript" aria-label="Transcript">
      {ordered.map((turn) =>
        turn.speaker === 'INTERVIEWER' ? (
          <InterviewerTurn key={turn.id} turn={turn} />
        ) : (
          <CandidateTurn key={turn.id} turn={turn} />
        ),
      )}
      {children}
    </ol>
  );
}

function InterviewerAvatar() {
  return (
    <div className="mock-avatar" aria-hidden>
      <Icon name="user" size={16} />
    </div>
  );
}

function InterviewerTurn({ turn }: { turn: MockTurnView }) {
  const note = KIND_NOTE[turn.kind];
  return (
    <li className="mock-turn is-interviewer">
      <InterviewerAvatar />
      <div className="mock-bubble-wrap">
        <div className="mock-speaker t-caption">
          Interviewer{note ? ` · ${note}` : ''} · {stageLabel(turn.stage)}
        </div>
        {turn.text.trim() ? (
          <div className="mock-bubble">
            <Markdown content={turn.text} />
          </div>
        ) : null}
        {turn.problem ? <CodingProblemCard problem={turn.problem} /> : null}
      </div>
    </li>
  );
}

function CandidateTurn({ turn }: { turn: MockTurnView }) {
  return (
    <li className="mock-turn is-candidate">
      <div className="mock-bubble-wrap">
        <div className="mock-speaker t-caption">You</div>
        {turn.text.trim() ? <div className="mock-bubble">{turn.text}</div> : null}
        {turn.code ? (
          <div className="mock-code">
            <CodeBlock code={turn.code} language={turn.codeLanguage} />
          </div>
        ) : null}
        <LanguageFeedback language={turn.language} />
      </div>
    </li>
  );
}

/** Grammar and wording under an answer: "looks good", or each fix with why. */
export function LanguageFeedback({ language }: { language: MockTurnView['language'] }) {
  if (!language) return null;
  if (language.ok || language.corrections.length === 0) {
    return (
      <div className="mock-lang is-ok">
        <Icon name="check" size={12} /> Language looks good
      </div>
    );
  }
  return (
    <div className="mock-lang">
      <div className="t-caption mb1">Language</div>
      <ul className="mock-lang-list" aria-label="Language corrections">
        {language.corrections.map((fix, i) => (
          <li key={i}>
            <span>
              <del>{fix.original}</del> <span aria-hidden>→</span>
              <span className="sr-only"> should be </span> <ins>{fix.corrected}</ins>
            </span>
            {fix.note ? <span className="t-caption">{fix.note}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** An interviewer's coding problem: the statement, examples and constraints. */
export function CodingProblemCard({ problem }: { problem: CodingProblem }) {
  return (
    <section className="card mock-problem" aria-label={`Coding problem: ${problem.title}`}>
      <div className="row items-center g2 mb3">
        <Icon name="code" size={15} />
        <h4 className="t-h4">{problem.title}</h4>
      </div>
      <Markdown content={problem.statement} />
      {problem.examples.length > 0 ? (
        <div className="col g2 mt4">
          <div className="kv-label">Examples</div>
          {problem.examples.map((example, i) => (
            <div key={i} className="mock-example">
              <div>
                <div className="t-caption">Input</div>
                <pre>{example.input}</pre>
              </div>
              <div>
                <div className="t-caption">Output</div>
                <pre>{example.output}</pre>
              </div>
              {example.explanation ? (
                <div className="t-small mock-example-note">{example.explanation}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {problem.constraints.length > 0 ? (
        <div className="mt4">
          <div className="kv-label mb1">Constraints</div>
          <ul className="bullets" aria-label="Constraints">
            {problem.constraints.map((c) => (
              <li key={c} className="t-small mono">
                {c}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// -- The composer -------------------------------------------------------------

function Composer({
  interview,
  prep,
  disabled,
  sending,
  onSend,
}: {
  interview: MockInterviewView;
  prep: PrepView | null;
  disabled: boolean;
  sending: boolean;
  onSend: (input: {
    text?: string;
    code?: string | null;
    codeLanguage?: string | null;
  }) => Promise<unknown>;
}) {
  const lastQuestion = useMemo(
    () =>
      [...interview.turns]
        .sort((a, b) => a.order - b.order)
        .filter((t) => t.speaker === 'INTERVIEWER')
        .pop(),
    [interview.turns],
  );
  const coding = lastQuestion?.kind === 'CODING' || interview.stage === 'CODING';
  // The latest coding problem: a new one starts a fresh editor.
  const problemId = useMemo(
    () =>
      [...interview.turns]
        .sort((a, b) => a.order - b.order)
        .filter((t) => t.speaker === 'INTERVIEWER' && t.problem)
        .pop()?.id ?? null,
    [interview.turns],
  );

  const [text, setText] = useState('');
  const [code, setCode] = useState('');
  const [sentCode, setSentCode] = useState('');
  const [language, setLanguage] = useState<string | null>(null);
  const codeLanguage = language ?? defaultCodeLanguage(prep?.technologies ?? []);

  const [seenProblem, setSeenProblem] = useState(problemId);
  if (seenProblem !== problemId) {
    setSeenProblem(problemId);
    setCode('');
    setSentCode('');
  }

  // Code goes with an answer when it has changed since it was last sent.
  const codeToSend = coding && code.trim() && code !== sentCode ? code : null;
  const canSend = !disabled && (text.trim().length > 0 || codeToSend !== null);

  const send = async () => {
    if (!canSend) return;
    const body = text;
    const sent = codeToSend;
    setText('');
    if (sent) setSentCode(sent);
    try {
      await onSend({
        ...(body.trim() ? { text: body.trim() } : {}),
        code: sent,
        codeLanguage: sent ? codeLanguage : null,
      });
    } catch (error) {
      // A 503 saved the answer (the page offers a retry); anything else didn't.
      if (!isServiceUnavailable(error)) {
        setText(body);
        if (sent) setSentCode('');
      }
    }
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  const onEditorMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void sendRef.current());
  };

  return (
    <div className={`mock-composer${coding ? ' is-coding' : ''}`}>
      <div className="card col g3">
        {coding ? (
          <div className="col g2">
            <div className="row items-center justify-between g2 wrap">
              <span className="kv-label">Your code</span>
              <Select
                size="sm"
                aria-label="Code language"
                value={codeLanguage}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={disabled}
              >
                {CODE_LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="editor-shell" style={{ height: 280 }}>
              <Editor
                height="100%"
                language={codeLanguage}
                theme="vs-dark"
                value={code}
                onChange={(value) => setCode(value ?? '')}
                onMount={onEditorMount}
                options={{
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  padding: { top: 10 },
                  tabSize: 2,
                  readOnly: disabled,
                  // An interview has no autocomplete.
                  quickSuggestions: false,
                  suggestOnTriggerCharacters: false,
                  wordBasedSuggestions: 'off',
                  parameterHints: { enabled: false },
                }}
              />
            </div>
            <span className="t-caption">
              {code.trim() && code === sentCode
                ? 'This code is already sent; change it to send it again.'
                : 'Your code goes with your next answer.'}
            </span>
          </div>
        ) : null}
        <Textarea
          aria-label="Your answer"
          rows={coding ? 3 : 4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            coding
              ? 'Talk through your approach, then send it with your code.'
              : 'Answer as you would out loud.'
          }
          maxLength={8_000}
          disabled={disabled}
          onKeyDown={(event) => {
            // Enter is a new line: an answer is a paragraph, not a chat message.
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="row items-center justify-between g3 wrap">
          <span className="t-caption">
            <span className="kbd">Ctrl</span> + <span className="kbd">Enter</span> to send
          </span>
          <Button
            variant="primary"
            icon="send"
            loading={sending}
            disabled={!canSend}
            onClick={() => void send()}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

// -- The report ---------------------------------------------------------------

/** The interviewer's report: the score and verdict, each dimension, then every question. */
export function ReportView({ report, turns }: { report: MockReport; turns: MockTurnView[] }) {
  const ordered = useMemo(() => [...turns].sort((a, b) => a.order - b.order), [turns]);
  return (
    <div className="col g5" aria-label="Report">
      <div className="mock-report-top">
        <Panel>
          <div className="row items-center g4 wrap">
            <div
              className="mock-score"
              aria-label={`Overall score ${formatScore(report.overallScore)}`}
            >
              <span className={`mock-score-num text-${scoreTone(report.overallScore)}`}>
                {Math.round(report.overallScore * 10) / 10}
              </span>
              <span className="t-caption">/10</span>
            </div>
            <div className="col g2" style={{ minWidth: 0, flex: 1 }}>
              <div className="row items-center g2 wrap">
                <span className="t-h4">Verdict</span>
                <VerdictBadge verdict={report.verdict} />
              </div>
              <div className="t-body">{report.summary}</div>
            </div>
          </div>
        </Panel>
        <Panel title="How you scored">
          <ul className="mock-dimensions" aria-label="Scores by dimension">
            {report.dimensions.map((d) => (
              <li key={d.name}>
                <div className="row items-center g3">
                  <span className="t-small mock-dimension-name">
                    {DIMENSION_LABEL[d.name] ?? d.name}
                  </span>
                  <div style={{ flex: 1 }}>
                    <SkillMeter pct={d.score * 10} />
                  </div>
                  <span className="t-code mock-dimension-score">{formatScore(d.score)}</span>
                </div>
                {d.comment ? <div className="t-caption mt1">{d.comment}</div> : null}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="mock-report-lists">
        <Panel title="Strengths">
          <BulletList items={report.strengths} empty="Nothing stood out yet." />
        </Panel>
        <Panel title="To improve">
          <BulletList items={report.improvements} empty="Nothing to fix." />
        </Panel>
        <Panel title="Next steps">
          <BulletList items={report.nextSteps} empty="Keep practising." />
        </Panel>
      </div>

      <Panel
        title="Language"
        action={
          <Badge variant={scoreVariant(report.language.score)}>
            {formatScore(report.language.score)}
          </Badge>
        }
      >
        {report.language.note ? <div className="t-body">{report.language.note}</div> : null}
        {report.language.patterns.length > 0 ? (
          <div className="mt3">
            <div className="kv-label mb1">Patterns to work on</div>
            <ul className="bullets" aria-label="Language patterns">
              {report.language.patterns.map((p) => (
                <li key={p} className="t-small">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>

      <section aria-label="Question by question" className="col g3">
        <h2 className="t-h3">Question by question</h2>
        {report.questions.map((q, i) => (
          <QuestionReview key={`${q.turnOrder}-${i}`} question={q} number={i + 1} turns={ordered} />
        ))}
      </section>
    </div>
  );
}

function scoreTone(score: number): 'success' | 'warning' | 'error' {
  return scoreVariant(score) as 'success' | 'warning' | 'error';
}

function QuestionReview({
  question,
  number,
  turns,
}: {
  question: MockReportQuestion;
  number: number;
  /** In order. */
  turns: MockTurnView[];
}) {
  const asked = turns.find((t) => t.speaker === 'INTERVIEWER' && t.order === question.turnOrder);
  const answer = turns.find((t) => t.speaker === 'CANDIDATE' && t.order > question.turnOrder);
  const assessment = answer?.assessment ?? null;
  const verdict = assessment
    ? (ASSESSMENT[assessment.verdict] ?? { label: assessment.verdict, variant: 'neutral' as const })
    : null;

  return (
    <Card className="mock-review" role="group" aria-label={`Question ${number}`}>
      <div className="row items-start justify-between g3">
        <div className="row items-center g2 wrap">
          <span className="t-caption">Q{number}</span>
          {asked ? <Badge size="sm">{stageLabel(asked.stage)}</Badge> : null}
          <span className="t-small" style={{ fontWeight: 600 }}>
            {question.question}
          </span>
        </div>
        <div className="row items-center g2">
          {verdict ? (
            <Badge variant={verdict.variant} size="sm" title="How the answer held up">
              {verdict.label}
            </Badge>
          ) : null}
          <Badge variant={scoreVariant(question.score)} title="Score out of 10">
            Score {formatScore(question.score)}
          </Badge>
        </div>
      </div>

      <div className="mock-review-grid mt3">
        <div style={{ minWidth: 0 }}>
          <div className="kv-label mb1">The interviewer asked</div>
          {asked ? (
            <div className="t-small">
              <Markdown content={asked.text} />
              {asked.problem ? (
                <div className="t-caption mt1">Coding problem: {asked.problem.title}</div>
              ) : null}
            </div>
          ) : (
            <div className="t-small">{question.question}</div>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="kv-label mb1">You said</div>
          {answer ? (
            <div className="col g2">
              {answer.text.trim() ? <div className="t-small prep-answer">{answer.text}</div> : null}
              {answer.code ? <CodeBlock code={answer.code} language={answer.codeLanguage} /> : null}
            </div>
          ) : (
            <div className="t-caption">No answer.</div>
          )}
        </div>
      </div>

      {assessment?.note ? <div className="t-small mt3">{assessment.note}</div> : null}

      <div className="grid grid-halves g3 mt3">
        <div>
          <div className="kv-label mb1">What went well</div>
          <div className="t-small">{question.wentWell || '—'}</div>
        </div>
        <div>
          <div className="kv-label mb1">What could be better</div>
          <div className="t-small">{question.couldBeBetter || '—'}</div>
        </div>
      </div>

      {question.strongerAnswer ? (
        <details className="mock-stronger mt3">
          <summary>A stronger answer</summary>
          <div className="t-small mt2">
            <Markdown content={question.strongerAnswer} />
          </div>
        </details>
      ) : null}
    </Card>
  );
}
