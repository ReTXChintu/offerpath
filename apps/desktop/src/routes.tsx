import { ApplicationReviewPage, JobDetailPage, SettingsPage, SetupPage } from '@offerpath/hunt';
import { AiFallbackSettings, GoalEditor, LearningSettings } from '@offerpath/learn';
import { Field, Panel, ThemeSelect } from '@offerpath/ui';
import { useParams, useSearch } from '@tanstack/react-router';

import { RequireAccount } from './learn';

/** Route wrappers: read the URL's params and hand them to the hunt pages. */
export function JobDetailRoute() {
  const { jobId } = useParams({ strict: false }) as { jobId?: string };
  return <JobDetailPage jobId={jobId ?? ''} />;
}

export function ApplicationReviewRoute() {
  const { applicationId } = useParams({ strict: false }) as { applicationId?: string };
  return <ApplicationReviewPage applicationId={applicationId ?? ''} />;
}

/**
 * Settings: the desktop's appearance, the goal, AI (the Claude models and the
 * OpenAI fallback for interview prep), then the hunt's settings.
 * `?tab=backend` opens Account; `?tab=ai` opens AI.
 */
export function SettingsRoute() {
  const { tab } = useSearch({ strict: false }) as { tab?: string };
  return (
    <SettingsPage
      // Keyed by the link's tab, so a link to another tab switches even from within Settings.
      key={tab ?? ''}
      initialTab={tab}
      extraTabs={[
        {
          value: 'appearance',
          label: 'Appearance',
          content: (
            <Panel title="Appearance">
              <Field
                label="Theme"
                hint="System follows your computer's light or dark setting; a choice here overrides it."
              >
                <div>
                  <ThemeSelect />
                </div>
              </Field>
            </Panel>
          ),
        },
        {
          value: 'goal',
          label: 'Goal & learning',
          content: (
            <RequireAccount>
              <GoalEditor />
            </RequireAccount>
          ),
        },
        {
          value: 'ai',
          label: 'AI',
          content: (
            <RequireAccount>
              <div className="col g4">
                <LearningSettings />
                <AiFallbackSettings />
              </div>
            </RequireAccount>
          ),
        },
      ]}
    />
  );
}

/** The first-run screen. */
export function SetupRoute() {
  return (
    <SetupPage
      intro={
        <div className="mb6">
          <p className="t-body" style={{ marginTop: 0 }}>
            <strong style={{ color: 'var(--text-primary)' }}>This desktop is your AI.</strong>{' '}
            Offerpath runs Claude Code here, with your own sign-in, to find jobs, prepare
            applications in your own Chrome and, soon, to coach you. Nothing runs AI on a server,
            and nothing is submitted without your approval.
          </p>
          <p className="t-body" style={{ marginBottom: 0 }}>
            <strong style={{ color: 'var(--text-primary)' }}>Keep it running.</strong> Closing this
            window hides Offerpath to the system tray, by the clock, where it keeps working and your
            phone and the web can reach it. Open it again from the tray icon; quit from the tray
            icon&apos;s menu.
          </p>
        </div>
      }
    />
  );
}
