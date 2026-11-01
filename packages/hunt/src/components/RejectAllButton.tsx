/**
 * "Reject all": clears the shown items that wait on the user in one go.
 * Each item goes through the same reject command as its own Reject button
 * (there is no bulk command), so it also works over the web relay.
 */
import { Alert, Button, Dialog, ProgressBar, toast } from '@offerpath/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { errorMessage, useInvoke } from '../client';
import { keys } from '../queries';
import type { ApplicationStatus, JobStatus } from '../types';

/** Waits on the user (approval or answers) and can be rejected from a list. */
export function isBulkRejectable(status: JobStatus | ApplicationStatus): boolean {
  return status === 'READY_FOR_REVIEW' || status === 'WAITING_FOR_USER';
}

export const BULK_REJECT_REASON = 'Bulk rejected: stale';

/** How many rejects run at once; small, so the relay and the store keep up. */
const CONCURRENCY = 3;

export interface RejectTarget {
  id: string;
  /** How a failure names it, e.g. "Senior Frontend Engineer at Acme". */
  label: string;
  status: JobStatus | ApplicationStatus;
}

interface Failure {
  index: number;
  label: string;
  message: string;
}

const WAITING_LABELS: Partial<Record<JobStatus | ApplicationStatus, string>> = {
  READY_FOR_REVIEW: 'awaiting your approval',
  WAITING_FOR_USER: 'waiting for your answers',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function RejectAllButton({
  kind,
  targets,
  skipped = 0,
}: {
  /** Applications are rejected with `reject_application`, jobs with `reject_job`. */
  kind: 'applications' | 'jobs';
  /** The shown items that wait on the user, in the order shown. */
  targets: RejectTarget[];
  /** Shown items left alone because they don't wait on the user. */
  skipped?: number;
}) {
  const invoke = useInvoke();
  const qc = useQueryClient();
  const noun = kind === 'applications' ? 'application' : 'job';
  // The list can refresh while rejecting; the dialog keeps the items it opened with.
  const [batch, setBatch] = useState<RejectTarget[] | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [failures, setFailures] = useState<Failure[] | null>(null);

  if (targets.length === 0 && !batch) return null;

  const open = () => {
    setBatch(targets);
    setDone(0);
    setFailures(null);
  };
  const close = () => {
    if (running) return;
    setBatch(null);
    setFailures(null);
  };

  const rejectOne = (id: string) =>
    kind === 'applications'
      ? invoke('reject_application', { id, reason: BULK_REJECT_REASON })
      : invoke('reject_job', { id });

  const run = async (list: RejectTarget[]) => {
    setRunning(true);
    setDone(0);
    const failed: Failure[] = [];
    let next = 0;
    // One failure never stops the rest.
    const worker = async () => {
      while (next < list.length) {
        const index = next++;
        const item = list[index]!;
        try {
          await rejectOne(item.id);
        } catch (e) {
          failed.push({ index, label: item.label, message: errorMessage(e) });
        }
        setDone((d) => d + 1);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
    for (const key of [keys.applications, keys.jobs, keys.dashboard, ['application'], ['job']])
      void qc.invalidateQueries({ queryKey: key });
    setRunning(false);
    const rejected = list.length - failed.length;
    if (failed.length === 0) {
      setBatch(null);
      toast.show({
        type: 'success',
        title: `Rejected ${plural(rejected, noun)}`,
        description: 'You can reopen any of them later.',
      });
    } else {
      setFailures(failed.sort((a, b) => a.index - b.index));
    }
  };

  const n = batch?.length ?? 0;
  const breakdown = Object.entries(WAITING_LABELS)
    .map(([status, label]) => {
      const count = batch?.filter((t) => t.status === status).length ?? 0;
      return count ? `${count} ${label}` : '';
    })
    .filter(Boolean)
    .join(', ');

  return (
    <>
      <Button
        size="sm"
        variant="danger"
        icon="x"
        onClick={open}
        disabled={targets.length === 0}
        title={`Reject the ${plural(targets.length, noun)} shown that wait on you`}
      >
        Reject all
      </Button>
      <Dialog
        open={batch !== null}
        onOpenChange={(o) => {
          if (!o) close();
        }}
        title={
          failures
            ? `Rejected ${n - failures.length} of ${plural(n, noun)}`
            : `Reject ${plural(n, noun)}?`
        }
        description={failures ? undefined : 'You can reopen any of them later.'}
        hideClose
        dismissable={!running}
        footer={
          failures ? (
            <Button variant="primary" onClick={close}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={running}>
                Cancel
              </Button>
              <Button
                variant="solid-danger"
                onClick={() => batch && void run(batch)}
                loading={running}
              >
                {`Reject ${n}`}
              </Button>
            </>
          )
        }
      >
        {failures ? (
          <Alert status="error" title={`${plural(failures.length, noun)} could not be rejected`}>
            <ul className="col g1" style={{ margin: 0, paddingLeft: 18 }}>
              {failures.map((f) => (
                <li key={f.index}>
                  <strong>{f.label}</strong>: {f.message}
                </li>
              ))}
            </ul>
          </Alert>
        ) : running ? (
          <div className="col g2">
            <ProgressBar pct={n ? (done / n) * 100 : 0} label={`Rejecting ${noun}s`} />
            <span className="t-small text-muted tabular">
              {done} of {n} done
            </span>
          </div>
        ) : (
          <p className="t-small text-muted" style={{ margin: 0 }}>
            This rejects only the {plural(n, noun)} shown here
            {breakdown ? ` (${breakdown})` : ''}.
            {skipped === 1
              ? ` 1 other shown ${noun} doesn't wait on you and stays as it is.`
              : skipped > 1
                ? ` ${skipped} other shown ${noun}s don't wait on you and stay as they are.`
                : ''}
          </p>
        )}
      </Dialog>
    </>
  );
}
