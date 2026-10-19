import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Panel,
  PasswordInput,
  Select,
} from '@offerpath/ui';
import { useEffect, useState, type FormEvent } from 'react';

import { describeError } from '../../components/AiOffline';
import { Spinner } from '../../components/ui';
import {
  useFallbackKey,
  useFallbackModels,
  useRemoveFallbackKey,
  useSaveFallbackKey,
  type FallbackKeyInput,
  type FallbackKeyView,
} from '../../lib/interview-prep';
import type { ModelOption } from '../../lib/plan';

/**
 * Settings → AI: the user's own OpenAI key, used for interview prep only
 * when their laptop (Claude) is offline. The key is stored encrypted and
 * never shown again: only its last four characters.
 */
export function AiFallbackSettings() {
  const { data, isLoading, error, refetch } = useFallbackKey();

  if (isLoading) return <Spinner label="Loading the OpenAI fallback" />;
  if (!data) {
    return (
      <Panel title="OpenAI fallback for interview prep">
        <Alert
          status="error"
          actions={
            <Button size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        >
          {describeError(error, 'The OpenAI fallback settings did not load.')}
        </Alert>
      </Panel>
    );
  }
  return <FallbackForm view={data} />;
}

function FallbackForm({ view }: { view: FallbackKeyView }) {
  const save = useSaveFallbackKey();
  const remove = useRemoveFallbackKey();
  const models = useFallbackModels(view.configured && view.available);
  const [apiKey, setApiKey] = useState('');
  const [modelFast, setModelFast] = useState(view.modelFast);
  const [modelReasoning, setModelReasoning] = useState(view.modelReasoning);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    setModelFast(view.modelFast);
    setModelReasoning(view.modelReasoning);
  }, [view.modelFast, view.modelReasoning]);

  const disabled = !view.available;
  const changed =
    apiKey.trim().length > 0 ||
    modelFast.trim() !== view.modelFast ||
    modelReasoning.trim() !== view.modelReasoning;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    const key = apiKey.trim();
    if (!view.configured && !key) {
      setProblem('Enter your OpenAI API key.');
      return;
    }
    if (!modelFast.trim() || !modelReasoning.trim()) {
      setProblem('Choose both models.');
      return;
    }
    setProblem(null);
    const input: FallbackKeyInput = {};
    if (key) input.apiKey = key;
    if (modelFast.trim() !== view.modelFast) input.modelFast = modelFast.trim();
    if (modelReasoning.trim() !== view.modelReasoning) input.modelReasoning = modelReasoning.trim();
    save.mutate(input, {
      onSuccess: () => {
        setApiKey('');
        setSaved(true);
      },
    });
  };

  // Pickers once the saved key can list its models; free text until then.
  const options = view.configured && models.data && models.data.length > 0 ? models.data : null;

  return (
    <Panel
      title="OpenAI fallback for interview prep"
      action={
        view.configured ? (
          <Badge variant="success" icon="check">
            Key saved
          </Badge>
        ) : (
          <Badge>No key</Badge>
        )
      }
    >
      <div className="t-small mb4">
        Interview prep runs on your laptop&apos;s Claude. Only when your laptop is offline does it
        use your own OpenAI key instead, so a new prep or a practice answer does not have to wait.
        Nothing else uses this key. It is checked with OpenAI before it is saved, stored encrypted,
        and never shown again.
      </div>

      {!view.available ? (
        <Alert status="warning" title="This server cannot store API keys" className="mb4">
          The server owner must set ENCRYPTION_KEY before a key can be saved here.
        </Alert>
      ) : null}

      <form onSubmit={submit} className="col g4" aria-label="OpenAI fallback key" noValidate>
        <div className="grid grid-halves g4">
          <Field
            className="prep-key-field"
            label="OpenAI API key"
            hint={
              view.configured && view.last4 ? (
                <>
                  Saved key: <span className="t-code">••••{view.last4}</span>. Paste a new key to
                  replace it.
                </>
              ) : (
                'Starts with sk-. Create one at platform.openai.com.'
              )
            }
            error={problem && problem.includes('key') ? problem : undefined}
          >
            <PasswordInput
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setSaved(false);
              }}
              placeholder={view.configured && view.last4 ? `••••${view.last4}` : 'sk-…'}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
            />
          </Field>
          <ModelField
            label="Quick model"
            hint="Grades your practice answers."
            value={modelFast}
            onChange={setModelFast}
            options={options}
            disabled={disabled}
          />
          <ModelField
            label="Planning model"
            hint="Writes the plan and the questions."
            value={modelReasoning}
            onChange={setModelReasoning}
            options={options}
            disabled={disabled}
          />
        </div>

        {problem && !problem.includes('key') ? <Alert status="error">{problem}</Alert> : null}
        {save.error ? <Alert status="error">{describeError(save.error)}</Alert> : null}
        {remove.error ? <Alert status="error">{describeError(remove.error)}</Alert> : null}
        {models.error ? (
          <div className="t-caption">
            The model list did not load ({describeError(models.error)}); type a model id instead.
          </div>
        ) : null}

        <div className="row items-center g3 wrap">
          <Button
            type="submit"
            variant="primary"
            icon="save"
            loading={save.isPending}
            disabled={disabled || !changed}
          >
            {apiKey.trim() ? 'Check and save' : 'Save'}
          </Button>
          {view.configured ? (
            <Button
              variant="danger"
              icon="trash"
              onClick={() => setConfirmRemove(true)}
              disabled={remove.isPending}
            >
              Remove key
            </Button>
          ) : null}
          {saved ? <span className="t-caption">Saved</span> : null}
        </div>
      </form>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove the OpenAI key?"
        description="Interview prep then waits for your laptop when it is offline."
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined, { onSettled: () => setConfirmRemove(false) })}
      />
    </Panel>
  );
}

function ModelField({
  label,
  hint,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  options: ModelOption[] | null;
  disabled: boolean;
}) {
  if (options) {
    // A model saved earlier that the list no longer offers is still shown.
    const all = options.some((o) => o.id === value)
      ? options
      : [...options, { id: value, label: value }];
    return (
      <Field label={label} hint={hint}>
        <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          {all.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  return (
    <Field label={label} hint={`${hint} An OpenAI model id, such as gpt-4.1-mini.`}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        disabled={disabled}
      />
    </Field>
  );
}
