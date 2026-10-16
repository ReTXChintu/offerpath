import { Alert, Badge, Button, Dot, Field, Panel, Select } from '@offerpath/ui';
import { useEffect, useState } from 'react';

import { describeError } from '../../components/AiOffline';
import { Spinner } from '../../components/ui';
import { useSurface } from '../../context';
import {
  useAISettings,
  useUpdateAISettings,
  type AISettingsView,
  type ClaudeModels,
} from '../../lib/plan';

export { GoalEditor } from './GoalEditor';

/**
 * The learning settings: which Claude model each kind of work uses, and
 * whether the desktop that runs them is online with Claude.
 *
 * There is no vendor to pick and no key to paste: every AI call runs as
 * Claude Code on the user's own desktop, with their own sign-in.
 */
export function LearningSettings() {
  const { data: settings, isLoading, error } = useAISettings({ poll: true });

  if (isLoading) return <Spinner label="Loading the AI settings" />;
  if (!settings) {
    return <Alert status="error">{describeError(error, 'The AI settings did not load.')}</Alert>;
  }

  return (
    <div className="col g4">
      <DesktopPanel desktop={settings.desktop} />
      <ModelsPanel settings={settings} />
    </div>
  );
}

function DesktopPanel({ desktop }: { desktop: AISettingsView['desktop'] }) {
  const surface = useSurface();
  const ready = desktop.online && desktop.claudeAvailable;

  return (
    <Panel
      title="Where AI runs"
      action={
        <Badge variant={ready ? 'success' : desktop.online ? 'warning' : 'neutral'}>
          <Dot tone={ready ? 'success' : desktop.online ? 'warning' : 'neutral'} size="sm" />
          {ready ? 'Ready' : desktop.online ? 'Claude unavailable' : 'Desktop offline'}
        </Badge>
      }
    >
      <div className="t-small">
        The tutor, hints, grading and mock interviews run as Claude Code on your desktop, with your
        own Claude sign-in.{' '}
        {surface === 'desktop'
          ? 'That is this computer: keep Offerpath running (it waits in the tray).'
          : 'Keep the Offerpath desktop app running and signed in to this account.'}
      </div>
      <div className="t-small mt3">
        {desktop.online ? (
          <>
            Desktop online{desktop.version ? ` (version ${desktop.version})` : ''}.{' '}
            {desktop.claudeAvailable
              ? 'Claude is available.'
              : (desktop.detail ?? 'Claude is not available on it. Open Setup on the desktop.')}
          </>
        ) : (
          'Your desktop is offline: AI and job hunting wait for it. Practice and recall still work.'
        )}
      </div>
    </Panel>
  );
}

const KINDS: { key: keyof ClaudeModels; label: string; hint: string }[] = [
  { key: 'fast', label: 'Quick work', hint: 'Grading, hints and short answers.' },
  {
    key: 'reasoning',
    label: 'Planning and reviews',
    hint: 'Curriculum, roadmaps, design reviews and interview reports.',
  },
  {
    key: 'tutor',
    label: 'Tutor chat',
    hint: 'The assistant beside a concept or an exercise. Default follows Quick work.',
  },
];

function ModelsPanel({ settings }: { settings: AISettingsView }) {
  const update = useUpdateAISettings();
  const [draft, setDraft] = useState<ClaudeModels>(settings.models);
  const [saved, setSaved] = useState(false);

  useEffect(() => setDraft(settings.models), [settings.models]);

  const changed =
    draft.fast !== settings.models.fast ||
    draft.reasoning !== settings.models.reasoning ||
    draft.tutor !== settings.models.tutor;

  // A model saved earlier that the list no longer offers is still shown.
  const options = (current: string | null) =>
    current && !settings.options.some((o) => o.id === current)
      ? [...settings.options, { id: current, label: current }]
      : settings.options;

  return (
    <Panel title="Claude models">
      <div className="t-small mb4">Which Claude model each kind of work uses.</div>
      <div className="col g4">
        {KINDS.map((kind) => {
          const value = draft[kind.key];
          return (
            <Field key={kind.key} label={kind.label} hint={kind.hint}>
              <Select
                aria-label={kind.label}
                value={value ?? ''}
                onChange={(event) => {
                  setSaved(false);
                  const next = event.target.value;
                  setDraft((d) => ({
                    ...d,
                    [kind.key]: kind.key === 'tutor' ? next || null : next,
                  }));
                }}
                style={{ maxWidth: 320 }}
              >
                {kind.key === 'tutor' ? <option value="">Default ({draft.fast})</option> : null}
                {options(value).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          );
        })}
      </div>
      {update.error ? (
        <Alert status="error" className="mt4">
          {describeError(update.error)}
        </Alert>
      ) : null}
      <div className="row items-center g3 mt5">
        <Button
          variant="primary"
          disabled={!changed}
          loading={update.isPending}
          onClick={() => update.mutate(draft, { onSuccess: () => setSaved(true) })}
        >
          Save models
        </Button>
        {saved ? <span className="t-caption">Saved</span> : null}
      </div>
    </Panel>
  );
}
