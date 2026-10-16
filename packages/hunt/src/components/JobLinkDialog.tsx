import { Button, Checkbox, Dialog, Field, Input } from '@offerpath/ui';
import { useState } from 'react';

import { useApplyFromLink } from '../queries';
import { ErrorBanner } from './common';

/**
 * Paste a job posting's link from any job site and start: the agent opens
 * it, reads the posting, prepares a tailored resume and cover letter, and
 * (when ticked) approves and applies as soon as they're ready.
 */
export function JobLinkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const start = useApplyFromLink();
  const [url, setUrl] = useState('');
  const [applyNow, setApplyNow] = useState(true);
  const valid = /^https?:\/\/\S+\.\S+/i.test(url.trim());
  const close = () => {
    if (!start.isPending) onClose();
  };
  const submit = () =>
    start.mutate(
      { url: url.trim(), applyNow },
      {
        onSuccess: () => {
          setUrl('');
          onClose();
        },
      },
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title="Apply from a link"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={start.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="play"
            onClick={submit}
            loading={start.isPending}
            disabled={!valid}
          >
            Start
          </Button>
        </>
      }
    >
      <ErrorBanner error={start.error} title="Couldn't start" />
      <Field
        label="Job posting link"
        error={
          url.trim().length > 0 && !valid ? 'Paste a full link starting with https://' : undefined
        }
        hint="From LinkedIn, Naukri, Indeed, Wellfound, Cutshort or any other job site or careers page."
      >
        <Input
          autoFocus
          placeholder="https://www.linkedin.com/jobs/view/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid) submit();
          }}
        />
      </Field>
      <div className="col g1 mt4">
        <Checkbox checked={applyNow} onCheckedChange={setApplyNow}>
          Apply right away with the tailored resume (counts as my approval)
        </Checkbox>
        <p className="t-caption" style={{ margin: '0 0 0 26px' }}>
          {applyNow
            ? "It still stops to ask you anything the form needs that your profile doesn't answer, and never claims success without the site's confirmation."
            : 'It prepares the application and waits for you to review and approve it.'}
        </p>
      </div>
    </Dialog>
  );
}
