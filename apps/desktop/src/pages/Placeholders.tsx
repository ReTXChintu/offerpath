import { useDashboard } from '@offerpath/hunt';
import { Button, EmptyState, PageHeader, Panel, Stat, type IconName } from '@offerpath/ui';

import { NavLink } from '../shell/NavLink';

/** A page whose features arrive with the learning side (plan, phase 3). */
function ComingSoon({
  eyebrow,
  title,
  subtitle,
  icon,
  what,
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
  icon: IconName;
  what: string;
}) {
  return (
    <div>
      <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <EmptyState icon={icon} title="Coming in phase 3" description={what} />
    </div>
  );
}

export function TodayPage() {
  const dashboard = useDashboard();
  const d = dashboard.data;
  const waiting = d ? d.total.awaitingApproval + d.total.manualAction + d.total.waitingForUser : 0;
  return (
    <div>
      <PageHeader
        title="Today"
        subtitle="Your daily plan: what to learn, what to practise, and what the hunt needs from you."
      />
      <div className="grid grid-main-side g6">
        <EmptyState
          icon="routine"
          title="Your daily plan is coming in phase 3"
          description="Learning items, recall, interviews coming up and your progress toward the goal, with one Start my day button. Until then, the hunt has everything it needs from you below."
        />
        <Panel title="The hunt today">
          {d ? (
            <div className="col g3">
              <div className="grid grid-2 g3">
                <Stat
                  label="Waiting for you"
                  value={waiting}
                  tone={waiting ? 'warning' : 'default'}
                />
                <Stat label="Applied today" value={d.today.applied} tone="success" />
              </div>
              <div className="row g2 wrap">
                <NavLink href="/applications" className="btn btn-primary btn-sm">
                  Review applications
                </NavLink>
                <NavLink href="/hunt" className="btn btn-secondary btn-sm">
                  Hunt overview
                </NavLink>
              </div>
            </div>
          ) : (
            <div className="row g2 wrap">
              <NavLink href="/hunt" className="btn btn-secondary btn-sm">
                Hunt overview
              </NavLink>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function RoadmapPage() {
  return (
    <ComingSoon
      eyebrow="Grow"
      title="Roadmap"
      icon="route"
      subtitle="Your goal's skill tree: what's next and why."
      what="The roadmap for your goal moves here from ForgeRoutine: the skills it takes, where you stand on each, and the next step."
    />
  );
}

export function LearnPage() {
  return (
    <ComingSoon
      eyebrow="Grow"
      title="Learn"
      icon="learn"
      subtitle="Concepts by technology, with a tutor that runs on this desktop."
      what="Reading and the tutor move here from ForgeRoutine. The tutor runs through your own Claude on this desktop."
    />
  );
}

export function PracticePage() {
  return (
    <ComingSoon
      eyebrow="Grow"
      title="Practice"
      icon="practice"
      subtitle="Exercises, blind coding, projects and engineering challenges."
      what="Exercises and blind coding with the code editor and the sandbox move here from ForgeRoutine."
    />
  );
}

export function RecallPage() {
  return (
    <ComingSoon
      eyebrow="Grow"
      title="Recall"
      icon="brain"
      subtitle="Spaced review of what you've learnt."
      what="Spaced-repetition review moves here from ForgeRoutine."
    />
  );
}

export function InterviewsPage() {
  return (
    <ComingSoon
      eyebrow="Grow"
      title="Interviews"
      icon="interview"
      subtitle="Mock interviews, reports, and prep for the real interview calls you record."
      what="Typed and spoken mock interviews move here from ForgeRoutine, with prep tracks for the interviews you record on applications."
    />
  );
}

export function ProgressPage() {
  return (
    <div>
      <PageHeader
        title="Progress"
        subtitle="Skills, coding score, the hunt funnel and your history."
      />
      <EmptyState
        icon="progress"
        title="Coming in phase 3"
        description="Skills and coding score move here from ForgeRoutine, next to the hunt's funnel from discovered jobs to offers."
        action={
          <NavLink href="/hunt" className="btn btn-secondary btn-sm">
            See the hunt's numbers
          </NavLink>
        }
      />
    </div>
  );
}

/** Shown when the UI is opened in a browser tab instead of the desktop app. */
export function NotInTauri() {
  return (
    <div className="col items-center justify-center g3" style={{ height: '100vh', padding: 24 }}>
      <EmptyState
        icon="monitor"
        title="Offerpath runs as a desktop app"
        description="This page is served by the Vite dev server outside Tauri, so the desktop's Rust side is not available. Start the desktop app instead: pnpm dev:desktop"
        action={
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
      />
    </div>
  );
}
