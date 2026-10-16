import {
  useApplications,
  useJobs,
  type ApplicationListItem,
  type JobListItem,
} from '@offerpath/hunt';
import { FunnelPanel, ProgressPage, type FunnelCounts } from '@offerpath/learn';

/** The hunt's funnel from what the desktop synced. */
export function funnelFromSynced(
  jobs: JobListItem[] | undefined,
  applications: ApplicationListItem[] | undefined,
): FunnelCounts | null {
  if (!jobs && !applications) return null;
  const apps = applications ?? [];
  const reached = (statuses: string[]) =>
    apps.filter((a) => statuses.includes(a.application.status)).length;
  return {
    found: jobs?.length ?? 0,
    relevant: (jobs ?? []).filter((j) => j.analysis?.relevant).length,
    applied: reached(['APPLIED', 'INTERVIEW', 'OFFER']),
    interviews: reached(['INTERVIEW', 'OFFER']),
    offers: reached(['OFFER']),
  };
}

export function WebProgress() {
  const jobs = useJobs();
  const applications = useApplications();
  return (
    <ProgressPage
      hunt={
        <FunnelPanel
          counts={funnelFromSynced(jobs.data, applications.data)}
          note="From what your desktop last synced."
        />
      }
    />
  );
}
