import { ApplicationReviewPage, JobDetailPage, SettingsPage, SetupPage } from '@offerpath/hunt';
import { Field, Panel, ThemeSelect } from '@offerpath/ui';
import { useParams } from '@tanstack/react-router';

/** Route wrappers: read the URL's params and hand them to the hunt pages. */
export function JobDetailRoute() {
  const { jobId } = useParams({ strict: false }) as { jobId?: string };
  return <JobDetailPage jobId={jobId ?? ''} />;
}

export function ApplicationReviewRoute() {
  const { applicationId } = useParams({ strict: false }) as { applicationId?: string };
  return <ApplicationReviewPage applicationId={applicationId ?? ''} />;
}

/** Settings: the desktop's appearance first, then the hunt's settings. */
export function SettingsRoute() {
  return (
    <SettingsPage
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
