import {
  Badge,
  Button,
  Chips,
  EmptyState,
  Icon,
  Input,
  MatchScore,
  PageHeader,
  SegmentedControl,
  Table,
} from '@offerpath/ui';
import { useMemo, useState } from 'react';

import { useHuntNavigator } from '../client';
import { ErrorBanner, HuntStatusBadge, LocationFilter } from '../components/common';
import { JobLinkDialog } from '../components/JobLinkDialog';
import { SharedJobDialog } from '../components/SharedJobDialog';
import {
  filterJobs,
  JOB_FILTERS,
  locationOptions,
  sortJobs,
  timeAgo,
  type JobFilter,
} from '../logic';
import { useDiscoverJobs, useJobs, usePrepareApplications, useStartJobHunt } from '../queries';

export function JobsPage() {
  const jobs = useJobs();
  const discover = useDiscoverJobs();
  const prepare = usePrepareApplications();
  const huntPosts = useStartJobHunt();
  const nav = useHuntNavigator();
  const [sharing, setSharing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [filter, setFilter] = useState<JobFilter>('ALL');
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const items = useMemo(
    () => sortJobs(filterJobs(jobs.data ?? [], filter, query, location)),
    [jobs.data, filter, query, location],
  );
  // The filter counts follow the location, so "Applied · 3" means three in that place.
  const counts = useMemo(
    () =>
      Object.fromEntries(
        JOB_FILTERS.map((f) => [f.key, filterJobs(jobs.data ?? [], f.key, '', location).length]),
      ) as Record<JobFilter, number>,
    [jobs.data, location],
  );
  const places = useMemo(() => locationOptions((jobs.data ?? []).map((i) => i.job)), [jobs.data]);
  const huntSource = huntPosts.isPending ? huntPosts.variables?.sources?.[0] : undefined;

  return (
    <div>
      <PageHeader
        eyebrow="Hunt"
        title="Jobs"
        subtitle={`${jobs.data?.length ?? 0} jobs discovered`}
        actions={
          <>
            <Button
              variant="primary"
              icon="link"
              onClick={() => setLinking(true)}
              title="Paste a job link and start applying"
            >
              Apply from a link
            </Button>
            <Button
              icon="filePlus"
              onClick={() => setSharing(true)}
              title="Paste a job post or add screenshots/PDFs; get a resume and a Gmail draft"
            >
              Add a job I found
            </Button>
            <Button
              icon="building"
              onClick={() => huntPosts.mutate({ sources: ['Company careers'] })}
              loading={huntSource === 'Company careers'}
              title="Search the careers sites of the companies you picked in Settings > Job sources (Google, Microsoft, ...), then analyze the jobs and prepare applications for your review"
            >
              Company careers
            </Button>
            <Button
              icon="send"
              onClick={() => huntPosts.mutate({ sources: ['Telegram'] })}
              loading={huntSource === 'Telegram'}
              title="Read your Telegram channels since the last scan and prepare the job posts for review"
            >
              Scan Telegram
            </Button>
            <Button
              icon="mail"
              onClick={() => huntPosts.mutate({ sources: ['LinkedIn Posts'] })}
              loading={huntPosts.isPending}
              title="Search LinkedIn posts that ask for resumes by email, then analyze them and prepare applications for your review"
            >
              Find hiring posts
            </Button>
            <Button
              icon="wand"
              onClick={() => prepare.mutate()}
              loading={prepare.isPending}
              disabled={counts.RELEVANT === 0}
              title="Generate resumes and prepare applications for the best jobs already found (no new search); they wait for your approval"
            >
              Prepare applications
            </Button>
            <Button
              variant="subtle"
              icon="search"
              onClick={() => discover.mutate(undefined)}
              loading={discover.isPending}
              title="Search your enabled sources and score the jobs only. No resumes or applications are prepared; use Start job hunt for that."
            >
              Search only
            </Button>
          </>
        }
      />
      <ErrorBanner
        error={jobs.error ?? discover.error ?? prepare.error ?? huntPosts.error}
        onRetry={() => void jobs.refetch()}
      />
      <SharedJobDialog open={sharing} onClose={() => setSharing(false)} />
      <JobLinkDialog open={linking} onClose={() => setLinking(false)} />
      <div className="row g4 items-center wrap mb4">
        <div className="flex-1" style={{ minWidth: 0 }}>
          <SegmentedControl<JobFilter>
            label="Show jobs"
            value={filter}
            onChange={setFilter}
            options={JOB_FILTERS.map((f) => ({
              value: f.key,
              label: (
                <>
                  {f.label}
                  <span className="tab-count" style={{ marginLeft: 6 }}>
                    {counts[f.key]}
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
          aria-label="Search jobs"
          placeholder="Search title, company, skill"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon="briefcase"
          title={
            jobs.data?.length
              ? location
                ? `No jobs in "${location}" here`
                : 'No jobs match this filter'
              : 'No jobs yet'
          }
          description={
            jobs.data?.length
              ? 'Try another filter, place or search. This only looks through the jobs already found; it never searches the web.'
              : 'Start a job hunt from the Hunt overview, or use Search only to find and score jobs without preparing applications.'
          }
        />
      ) : (
        <Table interactive>
          <thead>
            <tr>
              <th style={{ width: '38%' }}>Job</th>
              <th>Location</th>
              <th>Posted</th>
              <th>Source</th>
              <th>Match</th>
              <th>Technologies</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.job.id} onClick={() => nav.navigate({ to: 'job', jobId: item.job.id })}>
                <td>
                  <div className="row g2 items-start">
                    {item.job.saved ? (
                      <span style={{ marginTop: 2 }}>
                        <Icon name="bookmark" size={14} label="Saved" />
                      </span>
                    ) : null}
                    <div style={{ minWidth: 0 }}>
                      <div className="row g2 items-center">
                        <span className="cell-title truncate">{item.job.title}</span>
                        {item.job.applyEmail ? (
                          <Badge
                            variant="info"
                            size="sm"
                            title={`Apply by email to ${item.job.applyEmail}`}
                          >
                            Email
                          </Badge>
                        ) : null}
                      </div>
                      <div className="t-caption truncate">
                        {item.job.company}
                        {item.job.remote ? ` · ${item.job.remote}` : ''}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="truncate" style={{ display: 'block', maxWidth: 160 }}>
                    {item.job.location || '—'}
                  </span>
                </td>
                <td className="text-muted">
                  {item.job.postedAt ?? timeAgo(item.job.discoveredAt)}
                </td>
                <td>
                  <div>{item.job.source}</div>
                  {item.job.sources.length > 1 ? (
                    <div className="t-caption">+{item.job.sources.length - 1} more</div>
                  ) : null}
                </td>
                <td>
                  <MatchScore
                    score={item.analysis?.matchScore}
                    relevant={item.analysis?.relevant}
                    compact
                  />
                </td>
                <td style={{ maxWidth: 220 }}>
                  <Chips
                    items={(item.analysis?.matchedSkills.length
                      ? item.analysis.matchedSkills
                      : item.job.skills
                    ).slice(0, 4)}
                    tone="info"
                    max={4}
                  />
                </td>
                <td>
                  <HuntStatusBadge status={item.job.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
