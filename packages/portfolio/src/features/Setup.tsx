import { Button, Field, Input, Panel, toast } from '@offerpath/ui';
import { useState, type FormEvent } from 'react';

import { ErrorAlert } from '../components/common';
import { usePortfolioHost } from '../context';
import { handleProblem, publicSiteUrl } from '../lib/format';
import { useCreatePortfolio } from '../queries';

/** Before there's a portfolio: what it is, and a handle to create one with. */
export function PortfolioSetup() {
  const { apiOrigin } = usePortfolioHost();
  const create = useCreatePortfolio();
  const [handle, setHandle] = useState('portfolio');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = handle.trim();
    const bad = handleProblem(value);
    setProblem(bad);
    if (bad) return;
    create.mutate(value, {
      onSuccess: (view) =>
        toast.show({
          type: 'success',
          title: 'Your portfolio is ready',
          description: `Its public address: ${publicSiteUrl(apiOrigin, view.publicUrl)}`,
        }),
    });
  };

  return (
    <Panel title="Create your portfolio">
      <p className="t-body mb2">
        Offerpath keeps your portfolio site&apos;s content (projects, skills, experience and
        developer tools) and serves it from a public address any portfolio site can read.
      </p>
      <p className="t-body mb5">
        Your profile&apos;s projects, experience and skills arrive as drafts, and you choose what to
        publish.
      </p>
      <form onSubmit={submit} className="grid grid-halves g4" noValidate aria-label="Create">
        <div className="col g3">
          <Field
            label="Handle"
            hint="Your portfolio's name in its address: 3–40 lowercase letters, digits or dashes."
            error={problem ?? undefined}
            required
          >
            <Input
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              spellCheck={false}
              maxLength={40}
            />
          </Field>
          <div className="t-caption mono">
            {publicSiteUrl(apiOrigin, `/api/v1/public/portfolio/${handle.trim() || '…'}/site`)}
          </div>
          <ErrorAlert error={create.error} fallback="The portfolio was not created." />
          <div>
            <Button type="submit" variant="primary" icon="plus" loading={create.isPending}>
              Create portfolio
            </Button>
          </div>
        </div>
        <ol className="col g3 pf-steps" aria-label="What happens next">
          <li>
            <strong>Drafts arrive from your profile.</strong> Review them and publish the ones you
            want on your site.
          </li>
          <li>
            <strong>Connect Cloudinary</strong> to upload project images; a project needs one to be
            published.
          </li>
          <li>
            <strong>Point your site at the address.</strong> Overview has a ready-made Netlify proxy
            for it.
          </li>
        </ol>
      </form>
    </Panel>
  );
}
