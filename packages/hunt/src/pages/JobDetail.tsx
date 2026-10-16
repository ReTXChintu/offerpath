import {
  BulletList,
  Button,
  Chips,
  ConfirmDialog,
  Icon,
  KeyValue,
  MatchScore,
  Panel,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@offerpath/ui';
import { useState } from 'react';

import { useAppName, useHuntNavigator } from '../client';
import { ErrorBanner, HuntStatusBadge, InfoBanner, Loading } from '../components/common';
import { FileLinks, HtmlPreview } from '../components/DocumentPreview';
import { MissingSkills } from '../components/MissingSkills';
import { formatDateTime } from '../logic';
import {
  useAnalyzeJob,
  useApproveApplication,
  useGenerateResume,
  useJob,
  useOpenUrl,
  useRejectJob,
  useSetJobSaved,
} from '../queries';

export function JobDetailPage({ jobId }: { jobId: string }) {
  const detail = useJob(jobId);
  const analyze = useAnalyzeJob();
  const generate = useGenerateResume();
  const approve = useApproveApplication();
  const reject = useRejectJob();
  const save = useSetJobSaved();
  const openUrl = useOpenUrl();
  const nav = useHuntNavigator();
  const appName = useAppName();
  const [confirmApprove, setConfirmApprove] = useState(false);

  if (detail.isLoading) return <Loading label="Loading the job" />;
  if (detail.error || !detail.data)
    return (
      <ErrorBanner error={detail.error ?? 'Job not found'} onRetry={() => void detail.refetch()} />
    );
  const { job, analysis, application, resume, coverLetter } = detail.data;
  const canApprove = application?.status === 'READY_FOR_REVIEW';
  const hasMaterials = !!resume;

  return (
    <div>
      <div className="row justify-between items-center g2 wrap mb4">
        <Button
          variant="ghost"
          size="sm"
          icon="arrowLeft"
          onClick={() => nav.navigate({ to: 'jobs' })}
        >
          Jobs
        </Button>
        <div className="row g2 wrap">
          <Button size="sm" icon="externalLink" onClick={() => openUrl.mutate(job.url)}>
            Open Original Job
          </Button>
          <Button
            size="sm"
            icon={job.saved ? 'bookmarkCheck' : 'bookmark'}
            onClick={() => save.mutate({ id: job.id, saved: !job.saved })}
          >
            {job.saved ? 'Saved' : 'Save'}
          </Button>
          {job.status !== 'REJECTED' && job.status !== 'APPLIED' ? (
            <Button
              size="sm"
              variant="danger"
              icon="x"
              onClick={() => reject.mutate(job.id)}
              loading={reject.isPending}
            >
              Reject
            </Button>
          ) : null}
          {canApprove ? (
            <Button
              size="sm"
              variant="primary"
              icon="check"
              onClick={() => setConfirmApprove(true)}
            >
              Approve &amp; Apply
            </Button>
          ) : application ? (
            <Button
              size="sm"
              variant="subtle"
              onClick={() => nav.navigate({ to: 'application', applicationId: application.id })}
            >
              Open application
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              icon="sparkles"
              onClick={() => generate.mutate(job.id)}
              loading={generate.isPending}
              disabled={job.status === 'REJECTED'}
            >
              Prepare application
            </Button>
          )}
        </div>
      </div>
      <ErrorBanner error={analyze.error ?? generate.error ?? approve.error ?? reject.error} />

      <div className="mb5">
        <div className="row g3 items-center wrap mb1">
          <h1 className="t-h1">{job.title}</h1>
          <HuntStatusBadge status={job.status} />
        </div>
        <div className="t-h3 text-muted" style={{ fontWeight: 450 }}>
          {job.company}
          {job.location ? ` · ${job.location}` : ''}
          {job.remote ? ` · ${job.remote}` : ''}
        </div>
      </div>

      <div className="grid grid-5 g4 mb6">
        <KeyValue label="Salary">{job.salary ?? 'Not stated'}</KeyValue>
        <KeyValue label="Posted">{job.postedAt ?? 'Unknown'}</KeyValue>
        <KeyValue label="Employment">{job.employmentType ?? 'Not stated'}</KeyValue>
        <KeyValue label="Seniority">{job.seniority ?? 'Not stated'}</KeyValue>
        <KeyValue label="Sources">
          <div className="col items-start g1">
            {job.sources.map((s) => (
              <button
                key={s.url}
                type="button"
                className="link row g1 items-center"
                onClick={() => openUrl.mutate(s.url)}
              >
                {s.platform} <Icon name="externalLink" size={11} />
              </button>
            ))}
          </div>
        </KeyValue>
      </div>

      <div className="grid g6" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)' }}>
        <div style={{ minWidth: 0 }}>
          <Tabs defaultValue="description">
            <TabsList label="Job">
              <TabsTrigger value="description">Job description</TabsTrigger>
              <TabsTrigger value="resume" disabled={!hasMaterials}>
                Generated resume
              </TabsTrigger>
              <TabsTrigger value="cover" disabled={!coverLetter}>
                Cover letter
              </TabsTrigger>
              <TabsTrigger value="answers" disabled={!application}>
                Application answers
              </TabsTrigger>
            </TabsList>
            <TabsContent value="description">
              <Panel>
                <div className="selectable pre-wrap" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                  {job.description ||
                    'The full description was not captured. Use Open Original Job to read it on the source site.'}
                </div>
                {job.responsibilities.length ? (
                  <div className="mt5">
                    <h3 className="t-h4 mb2">Responsibilities</h3>
                    <BulletList items={job.responsibilities} />
                  </div>
                ) : null}
                {job.requirements.length ? (
                  <div className="mt5">
                    <h3 className="t-h4 mb2">Requirements</h3>
                    <BulletList items={job.requirements} />
                  </div>
                ) : null}
              </Panel>
            </TabsContent>
            <TabsContent value="resume">
              {resume ? (
                <div className="col g3">
                  <div className="row justify-between items-center g2 wrap">
                    <span className="t-small text-muted">
                      {resume.label}
                      {resume.validation
                        ? ` · ATS ${resume.validation.status} (${resume.validation.keywordCoverage}% keywords)`
                        : ''}
                    </span>
                    <FileLinks resume={resume} coverLetter={coverLetter} />
                  </div>
                  <HtmlPreview path={resume.htmlPath} />
                </div>
              ) : null}
            </TabsContent>
            <TabsContent value="cover">
              {coverLetter ? (
                <Panel>
                  <div className="selectable pre-wrap" style={{ fontSize: 13.5, lineHeight: 1.7 }}>
                    {coverLetter.text}
                  </div>
                </Panel>
              ) : null}
            </TabsContent>
            <TabsContent value="answers">
              {application ? (
                <Panel>
                  {application.answers.length === 0 ? (
                    <p className="t-small text-muted">No answers prepared yet.</p>
                  ) : (
                    <div className="col g2">
                      {application.answers.map((a) => (
                        <div key={a.question} style={{ fontSize: 13.5 }}>
                          <div style={{ fontWeight: 650 }}>{a.question}</div>
                          <div className="text-muted">
                            {a.answer} <span className="t-caption">({a.source.toLowerCase()})</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>
              ) : null}
            </TabsContent>
          </Tabs>
        </div>

        <div className="col g4" style={{ minWidth: 0 }}>
          <Panel
            title="Match analysis"
            action={
              <Button
                size="xs"
                variant="ghost"
                icon="refresh"
                onClick={() => analyze.mutate(job.id)}
                loading={analyze.isPending}
              >
                {analysis ? 'Re-analyze' : 'Analyze'}
              </Button>
            }
          >
            {!analysis ? (
              <p className="t-small text-muted">Not analyzed yet.</p>
            ) : (
              <div className="col g4">
                <MatchScore score={analysis.matchScore} relevant={analysis.relevant} />
                <div className="selectable" style={{ fontSize: 13.5 }}>
                  {analysis.summary}
                </div>
                <div className="grid grid-2 g2 t-small">
                  <Flag ok={analysis.requiredExperienceMet} label="Experience" />
                  <Flag ok={analysis.seniorityMatch} label="Seniority" />
                  <Flag ok={analysis.locationMatch} label="Location" />
                  <Flag ok={analysis.employmentTypeMatch} label="Employment type" />
                </div>
                <KeyValue label="Matched skills">
                  <Chips items={analysis.matchedSkills} tone="success" max={20} />
                </KeyValue>
                <KeyValue label="Missing skills">
                  <MissingSkills skills={analysis.missingSkills} />
                </KeyValue>
                <KeyValue label="Important keywords">
                  <Chips items={analysis.importantKeywords} max={20} />
                </KeyValue>
                <KeyValue label="Salary">{analysis.salaryAssessment || 'Not stated'}</KeyValue>
                {analysis.concerns.length ? (
                  <KeyValue label="Potential concerns">
                    <BulletList items={analysis.concerns} />
                  </KeyValue>
                ) : null}
              </div>
            )}
          </Panel>
          {application ? (
            <Panel title="Application">
              <div className="col g2 t-small">
                <div className="row justify-between items-center">
                  <span className="text-muted">Status</span>
                  <HuntStatusBadge status={application.status} />
                </div>
                {application.approvedAt ? (
                  <div className="row justify-between">
                    <span className="text-muted">Approved</span>
                    <span>{formatDateTime(application.approvedAt)}</span>
                  </div>
                ) : null}
                {application.appliedAt ? (
                  <div className="row justify-between">
                    <span className="text-muted">Applied</span>
                    <span>{formatDateTime(application.appliedAt)}</span>
                  </div>
                ) : null}
                {application.failureReason ? (
                  <InfoBanner status="warning">{application.failureReason}</InfoBanner>
                ) : null}
                <Button
                  size="sm"
                  variant="subtle"
                  icon="fileText"
                  block
                  onClick={() => nav.navigate({ to: 'application', applicationId: application.id })}
                >
                  Open application review
                </Button>
              </div>
            </Panel>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmApprove}
        onOpenChange={setConfirmApprove}
        title="Approve and apply?"
        description={`${appName} will open ${job.company}'s application in Chrome and fill it with the generated resume and your known answers. It will stop and ask you if it meets a question it cannot answer, a CAPTCHA, or a login wall.`}
        confirmLabel="Approve & Apply"
        loading={approve.isPending}
        onConfirm={() => {
          if (application)
            approve.mutate(
              { id: application.id, applyNow: true },
              {
                onSuccess: () => {
                  setConfirmApprove(false);
                  nav.navigate({ to: 'application', applicationId: application.id });
                },
              },
            );
        }}
      />
    </div>
  );
}

function Flag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="row g1 items-center">
      <span style={{ color: ok ? 'var(--success)' : 'var(--warning)' }}>
        <Icon name={ok ? 'check' : 'x'} size={14} label={ok ? 'Yes' : 'No'} />
      </span>
      <span>{label}</span>
    </span>
  );
}
