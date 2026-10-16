import { Button, Dialog, Spinner } from '@offerpath/ui';
import { useEffect, useState } from 'react';

import {
  useExperiences,
  useProjects,
  usePublishingPlan,
  useSavePublishingPlan,
  useSuggestProjectPicks,
} from '../queries';
import type { ProjectPick } from '../types';
import { ErrorBanner } from './common';

/**
 * Choose which projects appear on the job-site profiles. Claude suggests the
 * strongest ones with a reason each; the user adjusts and clicks Proceed.
 * Nothing is published before that.
 */
export function ProjectPicker({
  open,
  platform,
  onClose,
  onConfirmed,
}: {
  open: boolean;
  platform: string | null;
  onClose: () => void;
  onConfirmed: (platform: string | null) => void;
}) {
  const plan = usePublishingPlan();
  const projects = useProjects();
  const experiences = useExperiences();
  const suggest = useSuggestProjectPicks();
  const save = useSavePublishingPlan();
  const [picks, setPicks] = useState<ProjectPick[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  const askClaude = () =>
    suggest.mutate(undefined, {
      onSuccess: (p) => {
        setPicks(p);
        setSelected(p.filter((x) => x.selected).map((x) => x.projectId));
      },
    });

  // On open: start from the saved choice, or ask Claude for one.
  useEffect(() => {
    if (!open || !plan.data) return;
    if (plan.data.confirmedAt) {
      setPicks(plan.data.picks);
      setSelected(plan.data.featuredProjectIds);
    } else {
      askClaude();
    }
    // Runs once per opening (and when the saved choice changes), as in Job Hunter.
  }, [open, plan.data?.confirmedAt]);

  const all = projects.data ?? [];
  // Claude's order first (strongest first), then anything it didn't rank.
  const ordered = [
    ...picks
      .map((p) => all.find((x) => x.id === p.projectId))
      .filter((p): p is (typeof all)[number] => !!p),
    ...all.filter((p) => !picks.some((x) => x.projectId === p.id)),
  ];
  const reason = (id: string) => picks.find((p) => p.projectId === id)?.reason;
  const employer = (id: string | null) => experiences.data?.find((e) => e.id === id)?.company;
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)));
  const proceed = () =>
    save.mutate(
      {
        featuredProjectIds: ordered.filter((p) => selected.includes(p.id)).map((p) => p.id),
        picks,
      },
      {
        onSuccess: () => {
          onClose();
          onConfirmed(platform);
        },
      },
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={platform ? `Update your ${platform} profile` : 'Projects on your profiles'}
      description={
        platform
          ? `Claude will edit your ${platform} profile in Chrome to match this app: headline, summary, skills, experience, education, career preferences and the projects you tick below. It never posts to your feed, messages anyone, or changes account settings. After this first update, changes you make here are synced to ${platform} automatically (you can turn that off).`
          : 'Only the projects you tick appear on your job-site profiles. Claude suggests the strongest ones; change them as you like.'
      }
      size="lg"
      footerSpread
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            icon="sparkles"
            onClick={askClaude}
            loading={suggest.isPending}
            disabled={all.length === 0}
          >
            Ask Claude again
          </Button>
          <div className="row g2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={proceed}
              loading={save.isPending}
              disabled={suggest.isPending}
            >
              {platform
                ? `Proceed (${selected.length} project${selected.length === 1 ? '' : 's'})`
                : 'Save'}
            </Button>
          </div>
        </>
      }
    >
      <ErrorBanner error={suggest.error ?? save.error} />
      {suggest.isPending ? (
        <div className="row g2 justify-center items-center text-muted py3">
          <Spinner size="sm" />
          <span className="t-small">Claude is picking your strongest projects…</span>
        </div>
      ) : all.length === 0 ? (
        <p className="t-small text-muted">
          You have no projects yet. Add some on the Candidate page; the profile update works without
          them too.
        </p>
      ) : (
        <div className="col g1">
          {ordered.map((p) => {
            const meta = [employer(p.experienceId), p.role].filter(Boolean);
            return (
              <label key={p.id} className="checkbox-row list-row clickable" style={{ border: 0 }}>
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={(e) => toggle(p.id, e.target.checked)}
                />
                <span style={{ minWidth: 0 }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{p.name}</span>
                  {meta.length ? <span className="text-muted"> · {meta.join(' · ')}</span> : null}
                  {reason(p.id) ? (
                    <span
                      className="t-caption"
                      style={{ display: 'block', fontStyle: 'italic', marginTop: 2 }}
                    >
                      {reason(p.id)}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
