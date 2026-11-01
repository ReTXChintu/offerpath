import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Panel,
  PasswordInput,
} from '@offerpath/ui';
import { useState, type FormEvent } from 'react';

import { ErrorAlert } from '../components/common';
import { useRemoveCloudinary, useSaveCloudinary } from '../queries';
import type { CloudinaryStatus } from '../types';

/**
 * The user's own Cloudinary account, where project images go. The API checks
 * the credentials with Cloudinary before saving them, and keeps the secret
 * encrypted; only the key's last four characters come back.
 */
export function CloudinaryPanel({ status }: { status: CloudinaryStatus }) {
  const save = useSaveCloudinary();
  const remove = useRemoveCloudinary();
  const [cloudName, setCloudName] = useState(status.cloudName ?? '');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    if (!cloudName.trim() || !apiKey.trim() || !apiSecret.trim()) {
      setProblem('Enter the cloud name, the API key and the API secret.');
      return;
    }
    setProblem(null);
    save.mutate(
      { cloudName: cloudName.trim(), apiKey: apiKey.trim(), apiSecret: apiSecret.trim() },
      {
        onSuccess: (view) => {
          setApiKey('');
          setApiSecret('');
          setCloudName(view.cloudinary.cloudName ?? '');
          setSaved(true);
        },
      },
    );
  };

  return (
    <Panel
      title="Cloudinary"
      action={
        status.configured ? (
          <Badge variant="success" icon="cloud">
            {`Configured · key …${status.apiKeyLast4 ?? '????'}`}
          </Badge>
        ) : (
          <Badge icon="cloudOff">Not connected</Badge>
        )
      }
    >
      <div className="t-small mb4">
        Project images are uploaded to your own Cloudinary account, in its{' '}
        <span className="t-code">portfolio</span> folder. Find these on your Cloudinary dashboard.
        They are checked with Cloudinary before they are saved, and the secret is stored encrypted.
      </div>
      <form onSubmit={submit} className="col g4" aria-label="Cloudinary credentials" noValidate>
        <div className="grid grid-3 g4 pf-cloudinary-grid">
          <Field label="Cloud name">
            <Input
              value={cloudName}
              onChange={(e) => setCloudName(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field
            label="API key"
            hint={
              status.configured && status.apiKeyLast4
                ? `Saved key ends in ${status.apiKeyLast4}.`
                : undefined
            }
          >
            <Input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="API secret">
            <PasswordInput
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </div>
        {problem ? <Alert status="error">{problem}</Alert> : null}
        <ErrorAlert error={save.error} fallback="Cloudinary did not accept these." />
        <ErrorAlert error={remove.error} />
        <div className="row items-center g3 wrap">
          <Button type="submit" variant="primary" icon="save" loading={save.isPending}>
            {status.configured ? 'Check and replace' : 'Check and save'}
          </Button>
          {status.configured ? (
            <Button
              variant="danger"
              icon="trash"
              onClick={() => setConfirmRemove(true)}
              disabled={remove.isPending}
            >
              Remove
            </Button>
          ) : null}
          {saved ? <span className="t-caption">Saved</span> : null}
        </div>
      </form>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Disconnect Cloudinary?"
        description="Images already on your site stay where they are, but new ones can't be uploaded until you connect an account again."
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined, { onSettled: () => setConfirmRemove(false) })}
      />
    </Panel>
  );
}
