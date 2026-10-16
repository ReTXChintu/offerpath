import { Button, Checkbox, Dialog, Icon, Textarea } from '@offerpath/ui';
import { useState } from 'react';

import { useAppName, useHuntClient } from '../client';
import { fileName } from '../logic';
import { useAddSharedJob } from '../queries';
import { ErrorBanner } from './common';

/**
 * A job found outside the app (a LinkedIn post, a WhatsApp forward, a PDF):
 * paste it and/or add screenshots; Claude reads it, writes the resume and
 * cover letter, and saves the email as a Gmail draft for you to send.
 */
export function SharedJobDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const add = useAddSharedJob();
  const client = useHuntClient();
  const appName = useAppName();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [draftEmail, setDraftEmail] = useState(true);

  const pick = async () => {
    if (!client.pickFiles) return;
    const chosen = await client.pickFiles({
      multiple: true,
      filters: [
        { name: 'Screenshots and PDFs', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf'] },
      ],
    });
    setFiles((f) => [...f, ...chosen.filter((p) => !f.includes(p))].slice(0, 10));
  };
  const close = () => {
    if (add.isPending) return;
    onClose();
  };
  const submit = () =>
    add.mutate(
      { text, files, draftEmail },
      {
        onSuccess: () => {
          setText('');
          setFiles([]);
          onClose();
        },
      },
    );
  const ready = text.trim().length >= 30 || files.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title="Add a job you found"
      description={`Paste the job description and/or add screenshots or PDFs of it. Claude reads it, writes a tailored resume and cover letter, and creates the application in ${appName} for your review.`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={add.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="sparkles"
            onClick={submit}
            loading={add.isPending}
            disabled={!ready}
          >
            Prepare application
          </Button>
        </>
      }
    >
      <ErrorBanner error={add.error} title="Couldn't start" />
      <Textarea
        rows={8}
        aria-label="Job post"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste the job post here (optional if you add screenshots or PDFs)"
      />
      <div className="row g2 wrap items-center mt3">
        {client.pickFiles ? (
          <Button
            size="sm"
            icon="imagePlus"
            onClick={() => void pick()}
            disabled={files.length >= 10}
          >
            Add screenshots or PDFs
          </Button>
        ) : null}
        {files.map((f) => (
          <span key={f} className="tag">
            <span className="truncate" style={{ maxWidth: 200 }}>
              {fileName(f)}
            </span>
            <button
              type="button"
              aria-label={`Remove ${fileName(f)}`}
              onClick={() => setFiles((list) => list.filter((x) => x !== f))}
            >
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
      </div>
      <div className="mt4">
        <Checkbox checked={draftEmail} onCheckedChange={setDraftEmail}>
          Save the email as a Gmail draft with the resume attached (you review and send it)
        </Checkbox>
      </div>
    </Dialog>
  );
}
