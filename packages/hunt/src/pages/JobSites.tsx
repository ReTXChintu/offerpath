import {
  Badge,
  BulletList,
  Button,
  PageHeader,
  Panel,
  Switch,
  Tag,
  type BadgeVariant,
} from '@offerpath/ui';
import { useState } from 'react';

import { useActivity } from '../activity';
import { useAppName } from '../client';
import { ActivityFeed } from '../components/ActivityFeed';
import { AutoUpdatePanel } from '../components/AutoUpdatePanel';
import { ErrorBanner, InfoBanner, Loading } from '../components/common';
import { ProjectPicker } from '../components/ProjectPicker';
import { QuestionField } from '../components/QuestionField';
import { formatDateTime, isAgentRunning } from '../logic';
import {
  useAgentStatus,
  useAnswerPlatformQuestions,
  useOpenUrl,
  usePlatformProfiles,
  useProjects,
  usePublishingPlan,
  useSetPlatformAutoSync,
  useSyncPlatformProfile,
} from '../queries';
import type { ApplicationAnswer, PlatformProfileView, PlatformSyncStatus } from '../types';

const STATUS: Record<PlatformSyncStatus, { label: string; variant: BadgeVariant }> = {
  NEVER_SYNCED: { label: 'Not updated yet', variant: 'neutral' },
  SYNCING: { label: 'Updating…', variant: 'primary' },
  SYNCED: { label: 'Up to date', variant: 'success' },
  NEEDS_INPUT: { label: 'Needs your answers', variant: 'warning' },
  MANUAL_ACTION_REQUIRED: { label: 'Needs you in Chrome', variant: 'warning' },
  FAILED: { label: 'Failed', variant: 'error' },
};

export function JobSitesPage() {
  const platforms = usePlatformProfiles();
  const plan = usePublishingPlan();
  const projects = useProjects();
  const agent = useAgentStatus();
  const sync = useSyncPlatformProfile();
  const [picker, setPicker] = useState<{ open: boolean; platform: string | null }>({
    open: false,
    platform: null,
  });

  const busy = agent.data ? isAgentRunning(agent.data.state) : false;
  const confirmed = !!plan.data?.confirmedAt;
  const featured = (plan.data?.featuredProjectIds ?? [])
    .map((id) => projects.data?.find((p) => p.id === id)?.name)
    .filter((n): n is string => !!n);
  const update = (platform: string) =>
    confirmed ? sync.mutate({ platform }) : setPicker({ open: true, platform });

  return (
    <div>
      <PageHeader
        eyebrow="Hunt"
        title="Job sites"
        subtitle="Fill in your own LinkedIn, Naukri, Indeed and Wellfound profiles from this app, so applications don't stop to ask for details and every site says the same thing."
      />
      <ErrorBanner error={sync.error ?? platforms.error ?? plan.error} />

      {platforms.data ? <AutoUpdatePanel views={platforms.data} busy={busy} /> : null}

      <Panel
        title="Projects on your profiles"
        action={
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setPicker({ open: true, platform: null })}
          >
            {confirmed ? 'Change' : 'Choose with Claude'}
          </Button>
        }
      >
        {confirmed ? (
          featured.length ? (
            <div className="tag-list">
              {featured.map((name) => (
                <Tag key={name} tone="primary">
                  {name}
                </Tag>
              ))}
            </div>
          ) : (
            <p className="t-small text-muted" style={{ margin: 0 }}>
              No projects: your profiles show experience and skills only.
            </p>
          )
        ) : (
          <p className="t-small text-muted" style={{ margin: 0 }}>
            Not chosen yet. Claude will suggest your strongest few projects the first time you
            update a profile, and you decide before anything is published.
          </p>
        )}
      </Panel>

      {platforms.isLoading ? (
        <Loading label="Loading job-site profiles" />
      ) : (
        <div className="grid grid-halves g4 mt4">
          {platforms.data?.map((view) => (
            <PlatformCard
              key={view.profile.id}
              view={view}
              busy={busy}
              onUpdate={() => update(view.profile.platform)}
              onResume={() => sync.mutate({ platform: view.profile.platform, resume: true })}
              updating={sync.isPending && sync.variables?.platform === view.profile.platform}
            />
          ))}
        </div>
      )}

      <ProjectPicker
        open={picker.open}
        platform={picker.platform}
        onClose={() => setPicker({ open: false, platform: null })}
        onConfirmed={(platform) => {
          if (platform) sync.mutate({ platform });
        }}
      />
    </div>
  );
}

function PlatformCard({
  view,
  busy,
  updating,
  onUpdate,
  onResume,
}: {
  view: PlatformProfileView;
  busy: boolean;
  updating: boolean;
  onUpdate: () => void;
  onResume: () => void;
}) {
  const { profile, outOfDate } = view;
  const appName = useAppName();
  const agent = useAgentStatus();
  const activity = useActivity();
  const openUrl = useOpenUrl();
  const autoSync = useSetPlatformAutoSync();
  const answer = useAnswerPlatformQuestions();
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const status =
    outOfDate && profile.status === 'SYNCED'
      ? { label: 'Behind your profile', variant: 'warning' as const }
      : STATUS[profile.status];
  const running =
    profile.status === 'SYNCING' &&
    agent.data?.runKind === 'PROFILE_SYNC' &&
    agent.data.runId === profile.runId &&
    busy;
  const runEvents = running ? activity.filter((e) => e.runId === profile.runId).slice(-20) : [];
  const neverSynced = !profile.lastSyncedAt;
  // An update that stopped part-way continues in its session and tab.
  const canResume =
    !!profile.resumeSessionId &&
    (profile.status === 'FAILED' || profile.status === 'MANUAL_ACTION_REQUIRED');

  const submitAnswers = () => {
    const list: ApplicationAnswer[] = profile.pendingQuestions.map((q) => ({
      question: q.question,
      answer: (answers[q.id] ?? '').trim(),
      source: 'USER',
    }));
    answer.mutate(
      { platform: profile.platform, answers: list.filter((a) => a.answer) },
      { onSuccess: () => setAnswers({}) },
    );
  };
  const missingRequired = profile.pendingQuestions.some(
    (q) => q.required && !(answers[q.id] ?? '').trim(),
  );

  return (
    <Panel>
      <div className="col g3">
        <div className="row justify-between items-start g3">
          <div>
            <h3 className="t-h3">{profile.platform}</h3>
            <div className="t-caption">
              {profile.lastSyncedAt
                ? `Last updated ${formatDateTime(profile.lastSyncedAt)}`
                : `Never updated by ${appName}`}
            </div>
          </div>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>

        {profile.message && profile.status !== 'SYNCED' ? (
          <p
            className={profile.status === 'FAILED' ? 't-small text-error' : 't-small text-muted'}
            style={{ margin: 0 }}
          >
            {profile.message}
          </p>
        ) : null}
        {profile.status === 'MANUAL_ACTION_REQUIRED' ? (
          <InfoBanner status="warning" title="Finish this in Chrome">
            Sign in to {profile.platform} in Chrome (or clear the check it&apos;s showing), then
            click Resume: Claude carries on in the same tab.
          </InfoBanner>
        ) : null}

        {running ? <ActivityFeed events={runEvents} maxHeight="180px" compact /> : null}

        {profile.status === 'NEEDS_INPUT' && profile.pendingQuestions.length ? (
          <div className="card tint-warning" style={{ padding: 12, border: 0 }}>
            <div className="mb2" style={{ fontWeight: 650, fontSize: 13.5 }}>
              {profile.platform} asks for details your profile doesn&apos;t have
            </div>
            <div className="col g3">
              {profile.pendingQuestions.map((q) => (
                <QuestionField
                  key={q.id}
                  q={q}
                  value={answers[q.id] ?? ''}
                  onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                />
              ))}
              <div className="row justify-between items-center g2 wrap">
                <span className="t-caption">
                  Saved to your answers, so applications can use them too.
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  icon="send"
                  onClick={submitAnswers}
                  loading={answer.isPending}
                  disabled={missingRequired}
                >
                  Save &amp; continue
                </Button>
              </div>
              <ErrorBanner error={answer.error} />
            </div>
          </div>
        ) : null}

        {profile.changes.length && !running ? (
          <div>
            <div className="kv-label mb1">Last changes</div>
            <BulletList items={profile.changes.slice(0, 6)} />
            {profile.changes.length > 6 ? (
              <div className="t-caption">+{profile.changes.length - 6} more</div>
            ) : null}
            {profile.skipped.length ? (
              <div className="t-caption mt1">Skipped: {profile.skipped.join('; ')}</div>
            ) : null}
          </div>
        ) : null}

        <div className="row justify-between items-center g2 wrap">
          <Switch
            checked={profile.autoSync}
            disabled={neverSynced || autoSync.isPending}
            onCheckedChange={(enabled) => autoSync.mutate({ platform: profile.platform, enabled })}
            title={neverSynced ? 'Available after the first update' : undefined}
          >
            Include in automatic updates
          </Switch>
          <div className="row g2">
            {profile.profileUrl ? (
              <Button
                size="sm"
                icon="externalLink"
                onClick={() => openUrl.mutate(profile.profileUrl)}
              >
                Open
              </Button>
            ) : null}
            {canResume ? (
              <>
                <Button
                  size="sm"
                  onClick={onUpdate}
                  title="Start a fresh update instead of continuing"
                >
                  Start over
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon="play"
                  onClick={onResume}
                  loading={updating || running}
                >
                  Resume
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon="refresh"
                onClick={onUpdate}
                loading={updating || running}
              >
                {neverSynced ? 'Update profile' : 'Update again'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}
