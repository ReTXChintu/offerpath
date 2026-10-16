import {
  Button,
  EmptyState,
  Input,
  MatchScore,
  PageHeader,
  SegmentedControl,
  Table,
} from '@offerpath/ui';
import { useMemo, useState } from 'react';

import { useHuntNavigator } from '../client';
import { ErrorBanner, HuntStatusBadge, InfoBanner, LocationFilter } from '../components/common';
import { filterApplications, locationOptions, timeAgo } from '../logic';
import { useAgentStatus, useApplications, useCheckInbox, useRuns, useSettings } from '../queries';
import type { ApplicationStatus } from '../types';

type Bucket = 'PENDING' | 'ALL' | 'APPLIED' | 'REJECTED';
const BUCKETS: { key: Bucket; label: string; statuses?: ApplicationStatus[] }[] = [
  {
    key: 'PENDING',
    label: 'Needs attention',
    statuses: [
      'READY_FOR_REVIEW',
      'WAITING_FOR_USER',
      'MANUAL_ACTION_REQUIRED',
      'APPROVED',
      'APPLYING',
    ],
  },
  { key: 'APPLIED', label: 'Applied', statuses: ['APPLIED', 'INTERVIEW', 'OFFER'] },
  { key: 'REJECTED', label: 'Rejected / withdrawn', statuses: ['REJECTED', 'WITHDRAWN'] },
  { key: 'ALL', label: 'All' },
];

export function ApplicationsPage() {
  const apps = useApplications();
  const nav = useHuntNavigator();
  const [bucket, setBucket] = useState<Bucket>('PENDING');
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const items = useMemo(() => {
    const b = BUCKETS.find((x) => x.key === bucket);
    return filterApplications(apps.data ?? [], b?.statuses, query, location);
  }, [apps.data, bucket, query, location]);
  const places = useMemo(() => locationOptions((apps.data ?? []).map((i) => i.job)), [apps.data]);
  const awaiting = (apps.data ?? []).filter(
    (i) => i.application.status === 'READY_FOR_REVIEW',
  ).length;
  const sent = (apps.data ?? []).filter((i) =>
    ['APPLIED', 'INTERVIEW', 'OFFER'].includes(i.application.status),
  ).length;
  const checkInbox = useCheckInbox();
  const agent = useAgentStatus();
  const settings = useSettings();
  const hours = settings.data?.inboxCheckHours ?? 0;
  const runs = useRuns(40);
  const lastCheck = runs.data?.find((r) => r.kind === 'INBOX_CHECK');

  return (
    <div>
      <PageHeader
        eyebrow="Hunt"
        title="Applications"
        subtitle={
          awaiting > 0
            ? `${awaiting} application${awaiting === 1 ? '' : 's'} waiting for your approval`
            : 'Every submission needs your explicit approval.'
        }
        actions={
          <Button
            size="sm"
            icon="mail"
            onClick={() => checkInbox.mutate()}
            loading={checkInbox.isPending || agent.data?.state === 'CHECKING_INBOX'}
            disabled={sent === 0}
            title={
              hours
                ? `Also checked automatically every ${hours} hours`
                : 'Automatic checks are off (Settings)'
            }
          >
            Check Gmail for replies
          </Button>
        }
      />
      <ErrorBanner error={apps.error ?? checkInbox.error} onRetry={() => void apps.refetch()} />
      {lastCheck?.state === 'FAILED' && agent.data?.state !== 'CHECKING_INBOX' ? (
        <InfoBanner status="warning" title={`Gmail check failed ${timeAgo(lastCheck.startedAt)}`}>
          <div className="row justify-between items-center g3 wrap">
            <span>
              {lastCheck.error ?? "Claude couldn't read Gmail."} Make sure Chrome is open with the
              Claude extension connected and Gmail signed in.
              {hours ? ' It retries by itself in 15 minutes.' : ''}
            </span>
            <Button
              size="xs"
              variant="primary"
              icon="mail"
              onClick={() => checkInbox.mutate()}
              loading={checkInbox.isPending}
            >
              Retry now
            </Button>
          </div>
        </InfoBanner>
      ) : lastCheck?.finishedAt ? (
        <p className="t-caption mb3">
          Gmail last checked for replies {timeAgo(lastCheck.finishedAt)}
          {hours ? `; next check within ${hours} hours` : ' (automatic checks are off in Settings)'}
          .
        </p>
      ) : null}
      <div className="row g4 items-center wrap mb4">
        <div className="flex-1" style={{ minWidth: 0 }}>
          <SegmentedControl<Bucket>
            label="Show applications"
            value={bucket}
            onChange={setBucket}
            options={BUCKETS.map((b) => ({
              value: b.key,
              label: (
                <>
                  {b.label}
                  <span className="tab-count" style={{ marginLeft: 6 }}>
                    {filterApplications(apps.data ?? [], b.statuses, '', location).length}
                  </span>
                </>
              ),
            }))}
          />
        </div>
        <LocationFilter value={location} onChange={setLocation} options={places} />
        <Input
          size="sm"
          style={{ maxWidth: 240 }}
          aria-label="Search applications"
          placeholder="Search title, company"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon="send"
          title={location || query ? 'No applications match' : 'Nothing here'}
          description={
            location || query
              ? 'Try another place or search. This only looks through your own applications; it never searches the web.'
              : bucket === 'PENDING'
                ? 'Applications prepared by the agent will show up here for your review.'
                : 'No applications in this bucket.'
          }
        />
      ) : (
        <Table interactive>
          <thead>
            <tr>
              <th style={{ width: '40%' }}>Job</th>
              <th>Match</th>
              <th>Status</th>
              <th>Updated</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.application.id}
                onClick={() =>
                  nav.navigate({ to: 'application', applicationId: item.application.id })
                }
              >
                <td>
                  <div className="cell-title">{item.job.title}</div>
                  <div className="t-caption">
                    {item.job.company} · {item.job.location || item.job.source}
                  </div>
                </td>
                <td>
                  <MatchScore
                    score={item.analysis?.matchScore}
                    relevant={item.analysis?.relevant}
                    compact
                  />
                </td>
                <td>
                  <HuntStatusBadge status={item.application.status} />
                </td>
                <td className="text-muted">{timeAgo(item.application.updatedAt)}</td>
                <td>
                  <span
                    className={`t-caption truncate ${item.application.failureReason ? 'text-warning' : ''}`}
                    style={{ display: 'block', maxWidth: 320 }}
                  >
                    {item.application.failureReason ??
                      (item.application.pendingQuestions.length
                        ? `${item.application.pendingQuestions.length} question(s) need answers`
                        : item.application.evidence
                          ? 'Submission confirmed'
                          : '')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
