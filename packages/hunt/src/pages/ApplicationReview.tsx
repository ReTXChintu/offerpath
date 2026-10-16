import {
  Badge,
  BulletList,
  Button,
  Checkbox,
  Chips,
  ConfirmDialog,
  Input,
  KeyValue,
  MatchScore,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  type BadgeVariant,
} from '@offerpath/ui';
import { useEffect, useState, type ReactNode } from 'react';

import { useActivity } from '../activity';
import { useAppName, useHuntNavigator } from '../client';
import { ActivityFeed } from '../components/ActivityFeed';
import { ErrorBanner, HuntStatusBadge, InfoBanner, Loading } from '../components/common';
import { FileLinks, HtmlPreview } from '../components/DocumentPreview';
import { InterviewDialog } from '../components/InterviewDialog';
import { MissingSkills } from '../components/MissingSkills';
import { QuestionField } from '../components/QuestionField';
import { ResumeEditor } from '../components/ResumeEditor';
import { applicationActions, formatDateTime, interviewLine, isAgentRunning } from '../logic';
import {
  useAgentStatus,
  useAnswerQuestions,
  useApplication,
  useApplyApplication,
  useApproveApplication,
  useGenerateResume,
  useMarkManualComplete,
  useOpenUrl,
  useRejectApplication,
  useRestoreApplicationFiles,
  useSetApplicationStatus,
  useSettings,
  useUpdateCoverLetter,
  useUpdateResumeContent,
} from '../queries';
import type { ApplicationAnswer, ApplicationStatus, ResumeDocument } from '../types';

const REPLY_VARIANT: Record<string, BadgeVariant> = {
  INTERVIEW: 'success',
  OFFER: 'success',
  ASSESSMENT: 'warning',
  QUESTION: 'warning',
  REJECTION: 'error',
  ACKNOWLEDGEMENT: 'info',
};

const capitalize = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** A full-width band of the review card. */
function Section({
  children,
  tint,
  py = 20,
}: {
  children: ReactNode;
  tint?: 'warning' | 'success' | 'info' | 'muted';
  py?: number;
}) {
  return (
    <div
      className={tint ? `card-section tint-${tint}` : 'card-section'}
      style={{ paddingTop: py, paddingBottom: py }}
    >
      {children}
    </div>
  );
}

/**
 * One application, end to end: what the agent prepared, the questions only
 * the user can answer, approval, manual completion, interviews and replies.
 * Nothing is submitted without the user's explicit approval here.
 */
export function ApplicationReviewPage({ applicationId }: { applicationId: string }) {
  const detail = useApplication(applicationId);
  const agent = useAgentStatus();
  const settings = useSettings();
  const approve = useApproveApplication();
  const reject = useRejectApplication();
  const apply = useApplyApplication();
  const answer = useAnswerQuestions();
  const markApplied = useMarkManualComplete();
  const setStatus = useSetApplicationStatus();
  const regenerate = useGenerateResume();
  const updateResume = useUpdateResumeContent();
  const updateCover = useUpdateCoverLetter();
  const openUrl = useOpenUrl();
  const restoreFiles = useRestoreApplicationFiles();
  const nav = useHuntNavigator();
  const appName = useAppName();
  const activity = useActivity();

  const [confirm, setConfirm] = useState<'approve' | 'reject' | 'applied' | null>(null);
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [editingResume, setEditingResume] = useState(false);
  const [editingCover, setEditingCover] = useState(false);
  const [coverDraft, setCoverDraft] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saveForReuse, setSaveForReuse] = useState(true);
  const [markedSkills, setMarkedSkills] = useState<string[]>([]);

  useEffect(() => {
    if (detail.data?.coverLetter) setCoverDraft(detail.data.coverLetter.text);
  }, [detail.data?.coverLetter]);

  if (detail.isLoading) return <Loading label="Loading the application" />;
  if (detail.error || !detail.data)
    return (
      <ErrorBanner
        error={detail.error ?? 'Application not found'}
        onRetry={() => void detail.refetch()}
      />
    );
  const { application, job, analysis, resume, coverLetter } = detail.data;
  const busy = agent.data ? isAgentRunning(agent.data.state) : false;
  const thisRunActive =
    busy &&
    agent.data?.runKind === 'APPLICATION' &&
    activity.some((e) => e.runId === agent.data?.runId);
  const actions = applicationActions(application.status);
  const applyUrl = application.applicationUrl || job.url;
  const byEmail = !!job.applyEmail;
  const approveLabel = byEmail ? 'Approve & Send email' : 'Approve & Apply';
  const runEvents = activity.filter(
    (e) =>
      e.runId === application.runId ||
      (agent.data?.runId && e.runId === agent.data.runId && agent.data.runKind === 'APPLICATION'),
  );
  const sent = ['APPLIED', 'INTERVIEW', 'OFFER'].includes(application.status);

  const submitAnswers = () => {
    const list: ApplicationAnswer[] = application.pendingQuestions.map((q) => ({
      question: q.question,
      answer: (answers[q.id] ?? '').trim(),
      source: 'USER',
    }));
    if (list.some((a, i) => !a.answer && application.pendingQuestions[i]?.required)) return;
    answer.mutate({ id: application.id, answers: list.filter((a) => a.answer), saveForReuse });
  };

  return (
    <div>
      <div className="row justify-between items-center g2 wrap mb4">
        <Button
          variant="ghost"
          size="sm"
          icon="arrowLeft"
          onClick={() => nav.navigate({ to: 'applications' })}
        >
          Applications
        </Button>
        <div className="row g2 wrap">
          <Button size="sm" icon="externalLink" onClick={() => openUrl.mutate(applyUrl)}>
            {actions.canApplyManually ? 'Apply Manually' : 'Open Job Website'}
          </Button>
          {actions.canMarkApplied ? (
            <Button size="sm" variant="success" icon="check" onClick={() => setConfirm('applied')}>
              Mark as Applied
            </Button>
          ) : null}
          {actions.canReject ? (
            <Button size="sm" variant="danger" icon="x" onClick={() => setConfirm('reject')}>
              Reject
            </Button>
          ) : null}
          {actions.canApply ? (
            <Button
              size="sm"
              variant="primary"
              icon="play"
              onClick={() => apply.mutate({ id: application.id })}
              loading={apply.isPending}
            >
              Apply now
            </Button>
          ) : null}
          {actions.canApprove ? (
            <Button size="sm" variant="primary" icon="check" onClick={() => setConfirm('approve')}>
              {approveLabel}
            </Button>
          ) : null}
        </div>
      </div>
      <ErrorBanner
        error={
          restoreFiles.error ??
          approve.error ??
          reject.error ??
          apply.error ??
          answer.error ??
          markApplied.error ??
          setStatus.error ??
          regenerate.error ??
          updateResume.error ??
          updateCover.error
        }
      />

      <div className="card card-flush">
        <Section>
          <div className="row justify-between items-start g4">
            <div style={{ minWidth: 0 }}>
              <h1 className="t-h1">{job.title}</h1>
              <div className="t-h3 text-muted" style={{ fontWeight: 450 }}>
                {job.company}
                {job.location ? ` · ${job.location}` : ''}
                {job.remote ? ` · ${job.remote}` : ''}
              </div>
            </div>
            <div className="col items-end g1 shrink-0">
              <HuntStatusBadge status={application.status} />
              <span className="t-caption">Updated {formatDateTime(application.updatedAt)}</span>
            </div>
          </div>
        </Section>

        {application.status === 'WAITING_FOR_USER' && application.pendingQuestions.length > 0 ? (
          <Section tint="warning">
            <h2 className="t-h4 mb1">Human input required</h2>
            <p className="t-small text-muted mb4" style={{ marginTop: 0 }}>
              {application.failureReason ??
                'The application form asks questions the agent could not answer truthfully. Answer them below to continue.'}
            </p>
            <div className="col g3" style={{ maxWidth: 720 }}>
              {application.pendingQuestions.map((q) => (
                <QuestionField
                  key={q.id}
                  q={q}
                  value={answers[q.id] ?? ''}
                  onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                />
              ))}
              <div className="row justify-between items-center g3 wrap">
                <Checkbox checked={saveForReuse} onCheckedChange={setSaveForReuse}>
                  Remember these answers for future applications
                </Checkbox>
                <Button
                  variant="primary"
                  icon="send"
                  onClick={submitAnswers}
                  loading={answer.isPending}
                >
                  Continue application
                </Button>
              </div>
            </div>
          </Section>
        ) : null}

        {application.status === 'MANUAL_ACTION_REQUIRED' ? (
          <Section tint="warning">
            <h2 className="t-h4 mb1">Application could not be completed automatically</h2>
            <p className="t-small mb3" style={{ marginTop: 0 }}>
              <strong>Reason:</strong> {application.failureReason ?? 'Unknown'}
            </p>
            <p className="t-small text-muted mb3" style={{ marginTop: 0 }}>
              The application has been prepared. Open it in Chrome, finish it with the documents
              below, then mark it as applied.
            </p>
            <div className="row g2 wrap">
              <Button
                size="sm"
                variant="primary"
                icon="externalLink"
                onClick={() => openUrl.mutate(applyUrl)}
              >
                Open Application
              </Button>
              <Button size="sm" icon="check" onClick={() => setConfirm('applied')}>
                Mark as Applied
              </Button>
              {application.approvedAt ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="refresh"
                  onClick={() => apply.mutate({ id: application.id })}
                  loading={apply.isPending}
                >
                  {application.claudeSessionId ? 'Resume where it stopped' : 'Retry automatically'}
                </Button>
              ) : null}
            </div>
          </Section>
        ) : null}

        {sent ? (
          <Section tint="success" py={16}>
            <p className="t-small" style={{ margin: 0 }}>
              <strong>
                {application.status === 'APPLIED'
                  ? `Applied ${formatDateTime(application.appliedAt)}`
                  : application.status === 'INTERVIEW'
                    ? `Interview stage · ${application.interviews.length} interview${application.interviews.length === 1 ? '' : 's'} recorded`
                    : 'Offer received'}
              </strong>
              {application.status === 'APPLIED' && application.manualCompleted
                ? ' (completed manually)'
                : ''}
              {application.status === 'APPLIED' && application.evidence
                ? ` · Evidence: ${application.evidence}`
                : ''}
            </p>
            <div className="row g2 wrap items-center mt3">
              {application.status !== 'OFFER' ? (
                <Button
                  size="sm"
                  variant="success"
                  icon="calendarPlus"
                  onClick={() => setInterviewOpen(true)}
                  title="Record a call or email inviting you to interview"
                >
                  {application.status === 'INTERVIEW'
                    ? 'Add another interview'
                    : 'Got an interview call'}
                </Button>
              ) : null}
              <span className="t-small text-muted">Or mark as:</span>
              {(['OFFER', 'REJECTED', 'WITHDRAWN'] as ApplicationStatus[])
                .filter((s) => s !== application.status)
                .map((s) => (
                  <Button
                    key={s}
                    size="xs"
                    variant={s === 'OFFER' ? 'success' : 'danger'}
                    onClick={() => setStatus.mutate({ id: application.id, status: s })}
                    loading={setStatus.isPending}
                  >
                    {capitalize(s)}
                  </Button>
                ))}
            </div>
          </Section>
        ) : null}

        {application.interviews.length ? (
          <Section>
            <h2 className="t-eyebrow mb3">Interviews</h2>
            <div className="col g2">
              {[...application.interviews].reverse().map((i, idx) => (
                <div key={i.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                  <div className="row g3 items-start" style={{ minWidth: 0 }}>
                    <Badge variant="success">Round {application.interviews.length - idx}</Badge>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 650, fontSize: 13.5 }}>
                        {i.scheduledAt ? formatDateTime(i.scheduledAt) : 'Date to be confirmed'}
                      </div>
                      {interviewLine(i) ? <div className="t-small">{interviewLine(i)}</div> : null}
                      {i.notes ? (
                        <div className="t-small text-muted pre-wrap">{i.notes}</div>
                      ) : null}
                      <div className="t-caption">Recorded {formatDateTime(i.recordedAt)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        ) : null}
        <InterviewDialog
          open={interviewOpen}
          onOpenChange={setInterviewOpen}
          applicationId={application.id}
          company={job.company}
        />

        {application.replies.length ? (
          <Section>
            <h2 className="t-eyebrow mb3">Replies from {job.company}</h2>
            <div className="col g3">
              {[...application.replies].reverse().map((r) => (
                <div key={r.id} className="list-row" style={{ display: 'block' }}>
                  <div className="row g2 wrap items-center mb1">
                    <Badge variant={REPLY_VARIANT[r.kind] ?? 'neutral'}>{capitalize(r.kind)}</Badge>
                    {r.folder === 'SPAM' ? <Badge variant="solid-error">In Spam</Badge> : null}
                    <strong style={{ fontSize: 13.5 }}>{r.subject}</strong>
                  </div>
                  <div className="t-small selectable" style={{ color: 'var(--text-primary)' }}>
                    {r.summary}
                  </div>
                  <div className="t-caption mt1">
                    {r.from}
                    {r.receivedAt ? ` · ${r.receivedAt}` : ''}
                  </div>
                </div>
              ))}
            </div>
            <p className="t-caption mt2" style={{ marginBottom: 0 }}>
              Reply from your Gmail. {appName} only reads it
              {application.replies.some((r) => r.folder === 'SPAM')
                ? "; move anything found in Spam to your inbox so you don't miss follow-ups"
                : ''}
              .
            </p>
          </Section>
        ) : null}

        {thisRunActive ? (
          <Section py={16}>
            <h2 className="t-eyebrow mb2">Claude is working in Chrome</h2>
            <ActivityFeed events={runEvents.slice(-30)} maxHeight="200px" compact />
          </Section>
        ) : null}

        {application.emailDraftedAt && application.status !== 'APPLIED' ? (
          <Section tint="success" py={16}>
            <p className="t-small" style={{ margin: 0 }}>
              <strong>Email draft saved in Gmail</strong>{' '}
              {formatDateTime(application.emailDraftedAt)}, with the resume attached
              {job.applyEmail ? `, to ${job.applyEmail}` : '; add the recipient'}. Open Gmail
              Drafts, review it and send it, then click Mark as Applied.
            </p>
          </Section>
        ) : byEmail ? (
          <Section tint="info" py={16}>
            <p className="t-small" style={{ margin: 0 }}>
              <strong>Applies by email</strong> to {job.applyEmail}
              {job.contactName ? ` (posted by ${job.contactName})` : ''}. On approval {appName}{' '}
              sends it from your Gmail with the resume attached and the cover letter as the message:
              edit the cover letter below to change what&apos;s sent.
            </p>
          </Section>
        ) : null}

        <Section>
          <h2 className="t-eyebrow mb2">Job summary</h2>
          <div
            className="selectable pre-wrap scroll-y"
            style={{ fontSize: 13.5, lineHeight: 1.6, maxHeight: 220 }}
          >
            {job.description || 'No description captured.'}
          </div>
          {analysis?.summary ? (
            <p className="t-small text-muted mt3" style={{ fontStyle: 'italic', marginBottom: 0 }}>
              {analysis.summary}
            </p>
          ) : null}
        </Section>

        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)' }}>
          <div className="card-section" style={{ borderRight: '1px solid var(--border)' }}>
            <h2 className="t-eyebrow mb3">Match analysis</h2>
            {analysis ? (
              <div className="col g4">
                <MatchScore score={analysis.matchScore} relevant={analysis.relevant} />
                <KeyValue label="Skills">
                  <Chips items={analysis.matchedSkills} tone="success" max={15} />
                  {analysis.missingSkills.length ? (
                    <div className="mt2">
                      <MissingSkills
                        skills={analysis.missingSkills}
                        max={15}
                        onMarked={(s) => setMarkedSkills((m) => [...m, ...s])}
                      />
                    </div>
                  ) : null}
                </KeyValue>
                <KeyValue label="Experience">
                  {analysis.requiredExperienceMet
                    ? 'Requirement met'
                    : 'Posting asks for more experience than your records show'}
                </KeyValue>
                <KeyValue label="Location">
                  {analysis.locationMatch ? 'Matches your preferences' : 'Outside your preferences'}
                </KeyValue>
                <KeyValue label="Concerns">
                  <BulletList
                    items={[
                      ...analysis.concerns,
                      ...application.potentialIssues.filter((i) => !analysis.concerns.includes(i)),
                    ]}
                  />
                </KeyValue>
              </div>
            ) : (
              <p className="t-small text-muted">No analysis.</p>
            )}
          </div>
          <div className="card-section">
            <div className="row justify-between items-center g2 wrap mb3">
              <h2 className="t-eyebrow">Application materials</h2>
              <div className="row g2 items-center wrap">
                <FileLinks resume={resume} coverLetter={coverLetter} />
                <Button
                  size="xs"
                  variant="ghost"
                  icon="refresh"
                  onClick={() => regenerate.mutate(job.id)}
                  loading={regenerate.isPending}
                  disabled={application.status === 'APPLIED'}
                >
                  Regenerate
                </Button>
              </div>
            </div>
            <Tabs defaultValue="resume">
              <TabsList label="Application materials">
                <TabsTrigger value="resume">
                  Resume{resume?.validation ? ` · ATS ${resume.validation.status}` : ''}
                </TabsTrigger>
                <TabsTrigger value="cover" disabled={!coverLetter}>
                  Cover letter
                </TabsTrigger>
                <TabsTrigger value="answers">Answers ({application.answers.length})</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
              <TabsContent value="resume">
                {resume ? (
                  editingResume && resume.content ? (
                    <ResumeEditor
                      value={resume.content}
                      saving={updateResume.isPending}
                      onCancel={() => setEditingResume(false)}
                      onSave={(content: ResumeDocument) =>
                        updateResume.mutate(
                          { id: resume.id, content },
                          { onSuccess: () => setEditingResume(false) },
                        )
                      }
                    />
                  ) : (
                    <div className="col g3">
                      {resume.filesDeletedAt ? (
                        <InfoBanner status="info" title="Files deleted after applying">
                          <div className="row justify-between items-center g3 wrap">
                            <span>
                              The resume and cover letter were sent, so their files were removed.
                              Everything is still here and can be re-created.
                            </span>
                            <Button
                              size="xs"
                              icon="refresh"
                              onClick={() => restoreFiles.mutate(application.id)}
                              loading={restoreFiles.isPending}
                            >
                              Re-create files
                            </Button>
                          </div>
                        </InfoBanner>
                      ) : null}
                      {markedSkills.length ? (
                        <InfoBanner
                          status="success"
                          title={`Added ${markedSkills.join(', ')} to your skills`}
                        >
                          <div className="row justify-between items-center g3 wrap">
                            <span>
                              This resume was written before. Regenerate it so it can include{' '}
                              {markedSkills.length === 1 ? 'it' : 'them'}.
                            </span>
                            <Button
                              size="xs"
                              variant="primary"
                              icon="refresh"
                              onClick={() =>
                                regenerate.mutate(job.id, { onSuccess: () => setMarkedSkills([]) })
                              }
                              loading={regenerate.isPending}
                              disabled={application.status === 'APPLIED'}
                            >
                              Regenerate resume
                            </Button>
                          </div>
                        </InfoBanner>
                      ) : null}
                      {resume.validation ? (
                        <div className="grid grid-3 g2">
                          <KeyValue label="Keyword coverage">
                            {resume.validation.keywordCoverage}%
                          </KeyValue>
                          <KeyValue label="Unsupported claims">
                            {resume.validation.unsupportedClaims.length === 0
                              ? 'None'
                              : resume.validation.unsupportedClaims.join('; ')}
                          </KeyValue>
                          <KeyValue label="Missing keywords">
                            <MissingSkills
                              skills={resume.validation.missingKeywords.filter(
                                (k) =>
                                  !markedSkills.some((m) => m.toLowerCase() === k.toLowerCase()),
                              )}
                              onMarked={(s) => setMarkedSkills((m) => [...m, ...s])}
                            />
                          </KeyValue>
                        </div>
                      ) : null}
                      {resume.validation?.unsupportedClaims.length ? (
                        <InfoBanner status="warning" title="Review before applying">
                          The validator flagged statements it could not verify against your profile.
                          Edit the resume to remove anything that is not true.
                        </InfoBanner>
                      ) : null}
                      <div className="row g2 items-center">
                        <Button
                          size="xs"
                          icon="pencil"
                          onClick={() => setEditingResume(true)}
                          disabled={!resume.content || application.status === 'APPLIED'}
                        >
                          Edit Resume
                        </Button>
                        <span className="t-caption">
                          {resume.label}
                          {resume.userEdited ? ' · edited by you' : ''}
                        </span>
                      </div>
                      <HtmlPreview path={resume.htmlPath} height="640px" />
                    </div>
                  )
                ) : (
                  <p className="t-small text-muted">No resume generated yet.</p>
                )}
              </TabsContent>
              <TabsContent value="cover">
                {coverLetter ? (
                  editingCover ? (
                    <div className="col g2">
                      <Textarea
                        rows={16}
                        aria-label="Cover letter"
                        value={coverDraft}
                        onChange={(e) => setCoverDraft(e.target.value)}
                      />
                      <div className="row justify-end g2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingCover(false);
                            setCoverDraft(coverLetter.text);
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          loading={updateCover.isPending}
                          onClick={() =>
                            updateCover.mutate(
                              { id: coverLetter.id, text: coverDraft },
                              { onSuccess: () => setEditingCover(false) },
                            )
                          }
                        >
                          Save cover letter
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="col g2">
                      <div className="row g2 items-center">
                        <Button
                          size="xs"
                          icon="pencil"
                          onClick={() => setEditingCover(true)}
                          disabled={application.status === 'APPLIED'}
                        >
                          Edit Cover Letter
                        </Button>
                        {coverLetter.userEdited ? (
                          <span className="t-caption">edited by you</span>
                        ) : null}
                      </div>
                      <div
                        className="card selectable pre-wrap"
                        style={{ fontSize: 13.5, lineHeight: 1.7 }}
                      >
                        {coverLetter.text}
                      </div>
                    </div>
                  )
                ) : null}
              </TabsContent>
              <TabsContent value="answers">
                {application.answers.length === 0 ? (
                  <p className="t-small text-muted">No answers yet.</p>
                ) : (
                  <div className="col">
                    {application.answers.map((a) => (
                      <div
                        key={a.question}
                        className="row justify-between g3 t-small"
                        style={{ borderBottom: '1px solid var(--border)', padding: '6px 0' }}
                      >
                        <span style={{ fontWeight: 550, color: 'var(--text-primary)' }}>
                          {a.question}
                        </span>
                        <span className="text-muted" style={{ textAlign: 'right' }}>
                          {a.answer} <span className="t-caption">({a.source.toLowerCase()})</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
              <TabsContent value="history">
                <div className="col g2 t-small">
                  {[...application.statusHistory].reverse().map((h, i) => (
                    <div key={i} className="row justify-between items-center g2">
                      <span className="row g2 items-center">
                        <HuntStatusBadge status={h.status} size="sm" />
                        <span className="text-muted">{h.reason}</span>
                      </span>
                      <span className="t-caption">{formatDateTime(h.at)}</span>
                    </div>
                  ))}
                  {application.notes ? (
                    <div className="card tint-muted selectable pre-wrap t-caption mt3">
                      {application.notes}
                    </div>
                  ) : null}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {actions.canApprove ? (
          <div
            className="row justify-between items-center g3 wrap tint-muted"
            style={{ padding: '16px 22px', borderTop: '1px solid var(--border)' }}
          >
            <Button variant="danger" icon="x" onClick={() => setConfirm('reject')}>
              Reject
            </Button>
            <div className="row g3 items-center">
              {settings.data?.mockMode ? (
                <span className="t-caption text-warning">Mock mode: nothing will be submitted</span>
              ) : null}
              <Button
                variant="primary"
                size="lg"
                icon="check"
                onClick={() => setConfirm('approve')}
              >
                {approveLabel}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirm === 'approve'}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        title={byEmail ? 'Approve and send the email?' : 'Approve and apply?'}
        description={
          byEmail
            ? `${appName} will open Gmail in Chrome and send one email to ${job.applyEmail} with the subject "Application for ${job.title}", your cover letter below as the message, and this resume attached. It sends only after the attachment is in, and never emails anyone else.`
            : `${appName} will open ${job.company}'s application in Chrome and fill it with this resume${coverLetter ? ' and cover letter' : ''}. It only submits after every required field is filled, and stops to ask you about anything it cannot answer.`
        }
        confirmLabel={approveLabel}
        loading={approve.isPending}
        onConfirm={() =>
          approve.mutate(
            { id: application.id, applyNow: true },
            { onSuccess: () => setConfirm(null) },
          )
        }
      />
      <ConfirmDialog
        open={confirm === 'reject'}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        title="Reject this application?"
        destructive
        confirmLabel="Reject"
        loading={reject.isPending}
        onConfirm={() =>
          reject.mutate(
            { id: application.id, reason: rejectReason },
            { onSuccess: () => setConfirm(null) },
          )
        }
      >
        <Input
          aria-label="Reason (optional)"
          placeholder="Reason (optional)"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'applied'}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        title="Mark as applied?"
        description="Only confirm this after you submitted the application yourself."
        confirmLabel="Mark as Applied"
        loading={markApplied.isPending}
        onConfirm={() =>
          markApplied.mutate({ id: application.id }, { onSuccess: () => setConfirm(null) })
        }
      />
    </div>
  );
}
